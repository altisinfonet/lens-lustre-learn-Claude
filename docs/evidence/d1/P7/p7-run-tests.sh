#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P7 · the C-34 harness: the build-time check and the live PROBE both fail first,
# and a synthetic request-count test (R-82) shows what each shape costs.
#
# Synthetic test: the reload count IS the request count that matters — every
# NOTIFY pgrst makes PostgREST re-run its whole introspection (the 10.3 %
# baseline). Supabase's own event triggers are installed verbatim on a scratch
# PG17; a session LISTENs on pgrst and calls each function N times. A function
# with runtime DDL = N reloads; the guarded shape = 0.
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
#   PGPORT=5433 bash docs/evidence/d1/P7/p7-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p7reload; N="${N:-500}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
PROBE="$ROOT/supabase/migrations/PROBE_p7_no_runtime_ddl.sql"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
step() { printf '\n══ %s\n' "$*"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
reloads() { # reloads <sql-call>  → number of NOTIFY pgrst heard while calling it N times
  { echo "LISTEN pgrst;"; for i in $(seq 1 "$N"); do echo "SELECT $1;"; done; } \
    | psql -X -d "$DB" -tA 2>&1 | grep -c 'Asynchronous notification "pgrst"'; }

step "1 · build-time check: self-test, then the real tree"
node "$ROOT/scripts/db-p7-runtime-ddl-check.test.mjs" > "$T/selftest" 2>&1; rc=$?
want "$rc|$(tail -1 "$T/selftest")" "0|ALL CASES PASS" "self-test: $(grep -c '  PASS' "$T/selftest") cases pass"
out=$(node "$ROOT/scripts/db-p7-runtime-ddl-check.mjs" "$ROOT" 2>&1); rc=$?
echo "$out" | sed -n '2p;$p' | sed 's/^/        /'
want "$rc" "0" "the real staging tree is green"

step "2 · FAIL FIRST — the same check on the tree plus one planted migration"
mkdir -p "$T/tree/supabase/migrations" "$T/tree/scripts"
cp "$ROOT"/supabase/migrations/*.sql "$T/tree/supabase/migrations/"
cp "$ROOT/scripts/db-p7-runtime-ddl-allow.json" "$T/tree/scripts/"
cat > "$T/tree/supabase/migrations/20991231_0001_planted_runtime_ddl.sql" <<'SQL'
CREATE OR REPLACE FUNCTION public.p7_bad() RETURNS int LANGUAGE plpgsql AS $fn$
BEGIN
  COMMENT ON TABLE public.posts IS 'touched at runtime';
  RETURN 1;
END $fn$;
SQL
out=$(node "$ROOT/scripts/db-p7-runtime-ddl-check.mjs" "$T/tree" 2>&1); rc=$?
echo "$out" | grep -E 'HIT|FAIL' | sed 's/^/        /'
want "$rc" "1" "planted runtime COMMENT ON → red (exit 1)"

step "3 · synthetic request-count test on scratch PG17 ($N calls each)"
dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB"
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p7-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
q "SELECT '  server_version '||current_setting('server_version')"
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$T/tree/supabase/migrations/20991231_0001_planted_runtime_ddl.sql" >/dev/null
r_bad=$(reloads "public.p7_bad()"); r_good=$(reloads "public.p7_good()")
echo "        p7_bad()  (runtime COMMENT ON):          $r_bad schema reloads in $N calls"
echo "        p7_good() (temp table + DML, the guard): $r_good schema reloads in $N calls"
want "$r_bad" "$N" "runtime DDL = one full schema reload per call"
want "$r_good" "0" "the guarded shape = zero reloads"

step "4 · FAIL FIRST — the live PROBE on the same database"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$PROBE" 2>&1); rc=$?
echo "$out" | grep -m1 -E 'ERROR' | cut -c1-200 | sed 's/^/        /'
[ $rc -ne 0 ] && echo "$out" | grep -q 'PROBE FAIL P7' && echo "  PASS  PROBE refuses with p7_bad() present" || { echo "  FAIL  PROBE did not refuse (rc=$rc)"; fail=1; }
q "INSERT INTO cron.job (jobname, schedule, command) VALUES ('ok', '* * * * *', 'SELECT public.p7_good()')"
q "DROP FUNCTION public.p7_bad()"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$PROBE" 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q 'PROBE PASS P7' && echo "  PASS  PROBE passes once it is gone (p7_good + a cron job remain)" || { echo "  FAIL  PROBE on clean db (rc=$rc)"; echo "$out" | grep ERROR | head -2; fail=1; }
for shape in "cron:COMMENT ON TABLE public.posts IS 'x'" "fn:BEGIN EXECUTE format('ALTER TABLE %I SET (fillfactor=90)', 'posts'); RETURN 1; END" "fn:BEGIN PERFORM pg_notify('pgrst','reload schema'); RETURN 1; END"; do
  kind=${shape%%:*}; body=${shape#*:}
  if [ "$kind" = cron ]; then q "INSERT INTO cron.job (jobname, schedule, command) VALUES ('bad', '* * * * *', \$q\$$body\$q\$)"
  else q "CREATE FUNCTION public.p7_mut() RETURNS int LANGUAGE plpgsql AS \$f\$$body\$f\$"; fi
  out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$PROBE" 2>&1); rc=$?
  [ $rc -ne 0 ] && echo "$out" | grep -q 'PROBE FAIL P7' && echo "  PASS  PROBE refuses: $kind ${body:0:60}" || { echo "  FAIL  PROBE missed: $kind $body"; fail=1; }
  q "DELETE FROM cron.job WHERE jobname='bad'"; q "DROP FUNCTION IF EXISTS public.p7_mut()" >/dev/null 2>&1
done

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
