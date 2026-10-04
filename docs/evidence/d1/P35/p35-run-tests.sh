#!/usr/bin/env bash
# P35 · C-34 harness + R-82 synthetic test at launch scale.
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/P35/p35-run-tests.sh
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p35keys; USERS="${USERS:-10000}"; ROWS="${ROWS:-1000000}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261004_0003_p35_fk_indexes.sql"
RB="$ROOT/supabase/rollback/20261004_0003_p35_fk_indexes_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p35_keys.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe() { local want="$1" what="$2" needle="${3:-}"; run staging "$PROBE"
  if [ "$want" = pass ]; then [ $rc -eq 0 ] && echo "  PASS  PROBE passes — $what" || { echo "  FAIL  PROBE should pass — $what"; echo "$out" | grep ERROR; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep ERROR | grep -q "$needle" && { echo "  PASS  PROBE refuses — $what:"; echo "$out" | grep -m1 ERROR | sed 's/.*ERROR: */        /'; } || { echo "  FAIL  PROBE should refuse — $what"; fail=1; }; fi; }
delete_ms() { # FK-cascade time (ms) to delete the account owning the most post_hashtags rows; rolled back
  psql -X -d "$DB" -tA 2>&1 <<'SQL' | grep -o 'post_hashtags_author_id_fkey: time=[0-9.]*' | grep -o '[0-9.]*$'
BEGIN;
EXPLAIN (ANALYZE) DELETE FROM auth.users WHERE id = (SELECT author_id FROM public.post_hashtags GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1);
ROLLBACK;
SQL
}

step "1 · build-time check: self-test; the REAL tree is red before this PR's migration"
node "$ROOT/scripts/db-p35-keys-check.test.mjs" | tail -1 | grep -q 'ALL CASES PASS' && echo "  PASS  self-test (15 cases)" || { echo "  FAIL  self-test"; fail=1; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/supabase/migrations"; cp "$ROOT"/supabase/migrations/*.sql "$T/supabase/migrations/"; rm -f "$T/supabase/migrations/20261004_0003_p35_fk_indexes.sql"
out=$(node "$ROOT/scripts/db-p35-keys-check.mjs" "$T" 2>&1); rc=$?
[ $rc -eq 1 ] && { echo "  PASS  FAIL FIRST: staging's own tree (without 20261004_0003) is red:"; echo "$out" | grep HIT | sed 's/^/        /'; } || { echo "  FAIL  expected red on the tree without the fix"; fail=1; }
node "$ROOT/scripts/db-p35-keys-check.mjs" "$ROOT" >/dev/null && echo "  PASS  with 20261004_0003 the tree is green" || { echo "  FAIL  tree with fix"; fail=1; }

step "2 · scratch PG17 at launch scale: $USERS accounts, $ROWS post_hashtags rows (staging's shape)"
dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB"
q "SELECT '  server '||current_setting('server_version')"
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.hashtags (id uuid PRIMARY KEY);
CREATE TABLE public.posts (id uuid PRIMARY KEY);
CREATE TABLE public.post_hashtags (post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  hashtag_id uuid NOT NULL REFERENCES public.hashtags(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (post_id, hashtag_id));
CREATE INDEX idx_post_hashtags_author ON public.post_hashtags (hashtag_id, author_id);
CREATE INDEX idx_post_hashtags_hashtag ON public.post_hashtags (hashtag_id);
CREATE TABLE public.user_block_notices (blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, notified_at timestamptz NOT NULL, PRIMARY KEY (blocker_id, blocked_id));
INSERT INTO auth.users SELECT gen_random_uuid() FROM generate_series(1, $USERS);
INSERT INTO public.hashtags SELECT gen_random_uuid() FROM generate_series(1, 2000);
CREATE TEMP TABLE u AS SELECT id, row_number() OVER () AS n FROM auth.users;
CREATE TEMP TABLE h AS SELECT id, row_number() OVER () AS n FROM public.hashtags;
INSERT INTO public.posts SELECT gen_random_uuid() FROM generate_series(1, $ROWS / 2);
CREATE TEMP TABLE p AS SELECT id, row_number() OVER () AS n FROM public.posts;
INSERT INTO public.post_hashtags (post_id, hashtag_id, author_id)
  SELECT p.id, h.id, u.id FROM p JOIN u ON u.n = 1 + p.n % $USERS
  CROSS JOIN LATERAL (VALUES (1 + p.n % 2000), (1 + (p.n * 7) % 2000)) v(k) JOIN h ON h.n = v.k
  ON CONFLICT DO NOTHING;
CREATE TABLE public.legacy_no_pk (a int);
-- the six tables staging keeps without a PK (reasoned in the PROBE), same names, no key
CREATE TABLE public._v3_preflight_snapshot_competition_entries (id uuid);
CREATE TABLE public._v3_preflight_snapshot_judge_decisions (id uuid);
CREATE TABLE public._v3_preflight_snapshot_judge_tag_assignments (id uuid);
CREATE TABLE public._v3_preflight_snapshot_judging_tags (id uuid);
CREATE TABLE public.categories_migration_dropped (user_id uuid NOT NULL, old_label text NOT NULL, dropped_at timestamptz NOT NULL);
CREATE TABLE public.posts_dead_host_backup_20260812 (id uuid, image_urls text[], thumbnail_urls text[]);
VACUUM ANALYZE;
SQL
echo "        post_hashtags: $(q "SELECT count(*) FROM public.post_hashtags") rows, $(q "SELECT pg_size_pretty(pg_total_relation_size('public.post_hashtags'))")"

step "3 · FAIL FIRST — the live PROBE"
probe fail "a table with no PK and no reason" "no primary key"
q "DROP TABLE public.legacy_no_pk"
probe fail "the two unindexed foreign keys (staging's state)" "foreign key"
q "ALTER TABLE public.categories_migration_dropped ADD PRIMARY KEY (user_id, old_label)"
probe fail "a reasoned table that now has a key (stale reason)" "no longer needed"
q "ALTER TABLE public.categories_migration_dropped DROP CONSTRAINT categories_migration_dropped_pkey"
b1=$(delete_ms); b2=$(delete_ms); b3=$(delete_ms)
echo "        BEFORE: FK cascade into post_hashtags when one account is deleted: $b1 / $b2 / $b3 ms"

step "4 · apply 20261004_0003 (lane staging), probe, measure"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P35-0003: .*')" || { echo "  FAIL  apply"; echo "$out" | grep ERROR; fail=1; }
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-run is harmless (IF NOT EXISTS)" || { echo "  FAIL  re-run"; fail=1; }
probe pass "both foreign keys indexed; the 6 reasoned tables have no PK and are allowed"
a1=$(delete_ms); a2=$(delete_ms); a3=$(delete_ms)
echo "        AFTER:  FK cascade into post_hashtags: $a1 / $a2 / $a3 ms"
python3 -c "import sys; b=sorted([$b1,$b2,$b3])[1]; a=sorted([$a1,$a2,$a3])[1]; print(f'        median before {b:.1f} ms → after {a:.1f} ms  (×{b/a:.0f})'); sys.exit(0 if a*5 < b else 1)" && echo "  PASS  account deletion is at least 5× faster with the index" || { echo "  FAIL  speed-up"; fail=1; }

step "5 · rollback (lane guard) and back"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback without lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production) drops only its two indexes" || { echo "  FAIL  rollback"; fail=1; }
want_idx=$(q "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='post_hashtags'")
[ "$want_idx" = 3 ] && echo "  PASS  post_hashtags back to its 3 original indexes" || { echo "  FAIL  index count $want_idx"; fail=1; }
probe fail "after the rollback" "foreign key"

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
