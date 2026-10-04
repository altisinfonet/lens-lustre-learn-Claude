#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P1-H · synthetic churn test (R-82): the profiles dead-row ratio under P1's real
# write pattern, with REAL autovacuum, default settings vs 20261004_0001.
#
# Writers after P1 (no client timer): record_session_end() — one UPDATE of
# last_active_at/last_platform per session end — and backfill_last_seen() every
# 30 min. Both are non-HOT (idx_profiles_reengagement_scan indexes last_active_at),
# so the table below carries staging's six profiles indexes on the same columns.
#
# TIME COMPRESSION, stated: Supabase runs autovacuum_naptime = 60 s; this scratch
# cluster is set to 1 s for the run (ALTER SYSTEM, restored after). Launch load is
# 10,000 session ends/day ≈ 7 per minute; here they arrive at RATE per second —
# per naptime that is RATE/7 × harsher than launch (≈ 35× at 250/s), so the
# numbers are an upper bound, not a flattering average.
#
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/phase2/p1-churn-run.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p1churn
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261004_0001_profiles_autovacuum_tuning.sql"
RB="$ROOT/supabase/rollback/20261004_0001_profiles_autovacuum_tuning_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p1_profiles_autovacuum.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"; psql -q -X -d postgres -c "ALTER SYSTEM RESET autovacuum_naptime" -c "SELECT pg_reload_conf()" >/dev/null 2>&1' EXIT
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }

build() { # build <rows>
  dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB"
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, custom_url text,
  created_at timestamptz NOT NULL DEFAULT now(), last_active_at timestamptz, last_platform text,
  reengagement_sends_count int NOT NULL DEFAULT 0, last_reengagement_sent_at timestamptz,
  indexing_disabled boolean NOT NULL DEFAULT false, bio text);
-- staging's six indexes (pg_indexes, 2026-10-04 10:33 UTC), same definitions
CREATE INDEX idx_profiles_created_at_id_desc ON public.profiles USING btree (created_at DESC, id DESC);
CREATE INDEX idx_profiles_full_name_trgm ON public.profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_profiles_indexing_disabled ON public.profiles USING btree (indexing_disabled) WHERE (indexing_disabled = true);
CREATE INDEX idx_profiles_reengagement_scan ON public.profiles USING btree (last_active_at, reengagement_sends_count, last_reengagement_sent_at) WHERE (reengagement_sends_count < 4);
CREATE UNIQUE INDEX profiles_custom_url_unique ON public.profiles USING btree (lower(custom_url)) WHERE (custom_url IS NOT NULL);
-- rows ≈ staging's average width (366 B)
INSERT INTO public.profiles (full_name, custom_url, last_active_at, last_platform, bio)
  SELECT 'Member '||g, 'm'||g, now() - (g % 1440) * interval '1 minute', 'web', repeat(md5(g::text), 8) FROM generate_series(1, $1) g;
CREATE TABLE public.ids AS SELECT row_number() OVER () AS n, id FROM public.profiles;
CREATE UNIQUE INDEX ON public.ids (n);
VACUUM (ANALYZE) public.profiles;
SQL
}
churn() { # churn <rows> <updates> <rate/s> <backfill_every_s> <backfill_rows>  → prints max dead % and vacuums seen
  local rows=$1 n=$2 rate=$3 bevery=$4 brows=$5 secs=$(( $2 / $3 ))
  cat > "$T/session_end.sql" <<SQL
\set k random(1, $rows)
UPDATE public.profiles SET last_active_at = now(), last_platform = 'app' WHERE id = (SELECT id FROM public.ids WHERE n = :k);
SQL
  local v0; v0=$(q "SELECT autovacuum_count FROM pg_stat_user_tables WHERE relid='public.profiles'::regclass")
  ( while :; do q "SELECT round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),2) FROM pg_stat_user_tables WHERE relid='public.profiles'::regclass" 2>/dev/null; sleep 0.25; done ) > "$T/samples" &
  local sampler=$!
  ( s=0; while [ $s -lt $secs ]; do sleep "$bevery"; s=$((s + bevery)); q "WITH b AS (SELECT id FROM public.ids WHERE n <= $brows ORDER BY random() LIMIT $brows) UPDATE public.profiles p SET last_active_at = now() FROM b WHERE p.id = b.id" >/dev/null; done ) &
  local backfill=$!
  pgbench -n -f "$T/session_end.sql" -R "$rate" -T "$secs" -c 4 -j 2 "$DB" > "$T/pgbench.out" 2>&1 || { echo "  FAIL  pgbench"; tail -3 "$T/pgbench.out"; fail=1; }
  TX=$(grep -o 'number of transactions actually processed: [0-9]*' "$T/pgbench.out" | grep -o '[0-9]*$')
  sleep 3; kill $sampler $backfill 2>/dev/null; wait 2>/dev/null
  local v1; v1=$(q "SELECT autovacuum_count FROM pg_stat_user_tables WHERE relid='public.profiles'::regclass")
  OVER=$(awk '$1>=10{o++} END{printf "%.1f", 100*o/NR}' "$T/samples");
  MAX=$(sort -g "$T/samples" | tail -1); P95=$(sort -g "$T/samples" | awk '{a[NR]=$1} END {print a[int(NR*0.95)]}'); AV=$((v1 - v0)); SAMPLES=$(wc -l < "$T/samples")
}

psql -q -X -d postgres -c "ALTER SYSTEM SET autovacuum_naptime = '1s'" -c "SELECT pg_reload_conf()" >/dev/null
step "0 · scratch PG $(psql -X -d postgres -tAc "SELECT current_setting('server_version')"), autovacuum_naptime $(sleep 1; psql -X -d postgres -tAc "SHOW autovacuum_naptime") (compressed; Supabase: 60 s)"

for size in 100000 131; do
  if [ $size = 100000 ]; then UPD=20000; RATE=250; BE=10; BR=2000; else UPD=240; RATE=2; BE=30; BR=10; fi
  step "launch-shaped churn on $size profiles: $UPD session-end UPDATEs at $RATE/s + a backfill of $BR rows every ${BE}s"
  build $size
  churn $size $UPD $RATE $BE $BR
  echo "        DEFAULTS (threshold 50, scale 0.2): max dead $MAX %   p95 $P95 %   time ≥ 10 %: $OVER %   autovacuums $AV   ($TX updates, $SAMPLES samples)"
  d_max=$MAX
  build $size
  run staging "$MIG"; [ $rc -eq 0 ] || { echo "  FAIL  apply"; echo "$out" | grep ERROR; fail=1; }
  echo "        reloptions: $(q "SELECT reloptions FROM pg_class WHERE oid='public.profiles'::regclass")"
  churn $size $UPD $RATE $BE $BR
  echo "        P1-H  (threshold 0,  scale 0.05): max dead $MAX %   p95 $P95 %   time ≥ 10 %: $OVER %   autovacuums $AV   ($TX updates, $SAMPLES samples)"
  python3 -c "import sys; sys.exit(0 if float('$d_max') >= 10 else 1)" && echo "  PASS  FAIL FIRST: with the defaults the ratio reaches ≥ 10 % ($d_max %)" || { echo "  FAIL  defaults stayed under 10 % ($d_max %) — the test could not fail"; fail=1; }
  if [ $size = 100000 ]; then
    python3 -c "import sys; sys.exit(0 if float('$MAX') < 10 else 1)" && echo "  PASS  LAUNCH SCALE: with P1-H the ratio never reaches 10 % (max $MAX %)" || { echo "  FAIL  P1-H max $MAX %"; fail=1; }
  else
    # 131 rows: one backfill of 10 rows is 7.6 % of the table in a single statement, so ANY setting is above
    # 10 % for up to one naptime after it. What the setting controls is how long: p95 and the time share.
    python3 -c "import sys; sys.exit(0 if float('$P95') < 10 else 1)" && echo "  PASS  TODAY'S SIZE: p95 below 10 % ($P95 %); above 10 % for $OVER % of the time, only in the naptime after a burst (max $MAX %)" || { echo "  FAIL  P1-H p95 $P95 %"; fail=1; }
  fi
done

step "PROBE and rollback"
out=$(TARGET_LANE=staging bash "$RUNIT" "$DB" "$PROBE" 5432 2>&1); [ $? -eq 0 ] && echo "  PASS  PROBE passes with P1-H: $(echo "$out" | grep -o 'PROBE PASS.*')" || { echo "  FAIL  PROBE"; fail=1; }
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback without lane — refused" || { echo "  FAIL  rollback guard"; fail=1; }
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production): reloptions now '$(q "SELECT coalesce(reloptions::text,'(none)') FROM pg_class WHERE oid='public.profiles'::regclass")'" || { echo "  FAIL  rollback"; fail=1; }
out=$(TARGET_LANE=staging bash "$RUNIT" "$DB" "$PROBE" 5432 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'PROBE FAIL P1-H' && echo "  PASS  PROBE refuses after the rollback: $(echo "$out" | grep -m1 -o 'PROBE FAIL.*' | cut -c1-150)" || { echo "  FAIL  PROBE after rollback"; fail=1; }

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
