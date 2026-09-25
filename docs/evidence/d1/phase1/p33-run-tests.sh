#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P33 · 20260910_0036 — the harness.
#
# Builds the fixture on a scratch PostgreSQL 17 cluster, runs the assertion
# suite, and exercises the migration's and the rollback's REFUSALS as separate
# psql invocations — because a refusal can only be observed as a non-zero exit
# status, and a file that never refused is not evidence that it would.
#
# Each apply is dispatched the way apply-migration.yml has dispatched since
# PR #293 (R-13): one psql session, `-c "SET p32.lane = '<lane>';"` followed by
# `-f <file>`. The lane is asserted in the same session that runs the SQL, so
# what is rehearsed here is the real interlock and not a paraphrase of it.
#
# SCRATCH CLUSTER ONLY. It drops and recreates a database, SETs ROLE, and
# creates deliberately broken copies of production view definitions. Never
# point PGHOST at staging or production.
#
#   bash docs/evidence/d1/phase1/p33-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p33
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0036_p33_definer_view_read_closure.sql"
RB="$ROOT/supabase/rollback/20260910_0036_p33_definer_view_read_closure_ROLLBACK.sql"

fail=0
step() { printf '\n══ %s\n' "$*"; }

# expect_fail <what> <needle> <lane-or-empty> <file>
expect_fail() {
  local what="$1" needle="$2" lane="$3" file="$4" out rc
  if [ -n "$lane" ]; then
    out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET p32.lane = '$lane';" -f "$file" 2>&1); rc=$?
  else
    out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$file" 2>&1); rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    echo "  FAIL  $what — it was ACCEPTED (exit 0). It must refuse."; fail=1
  elif ! printf '%s' "$out" | grep -q "$needle"; then
    echo "  FAIL  $what — refused, but not with '$needle':"; printf '%s\n' "$out" | sed 's/^/        /' | head -6; fail=1
  else
    echo "  PASS  $what — refused (exit $rc), '$needle'"
  fi
}

# expect_ok <what> <lane-or-empty> <file>
expect_ok() {
  local what="$1" lane="$2" file="$3" out rc
  if [ -n "$lane" ]; then
    out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET p32.lane = '$lane';" -f "$file" 2>&1); rc=$?
  else
    out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$file" 2>&1); rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "  FAIL  $what — exit $rc:"; printf '%s\n' "$out" | sed 's/^/        /' | head -20; fail=1
  else
    echo "  PASS  $what"
  fi
}

step "0 · scratch cluster and fixture"
psql -q -d postgres -c "SELECT current_setting('server_version')" -tA | sed 's/^/  server_version /'
dropdb --if-exists "$DB" && createdb "$DB" || { echo "  cannot create $DB"; exit 2; }
if psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p33-fixture.sql" >/dev/null 2>&1; then
  echo "  PASS  fixture built"
else
  echo "  FAIL  fixture did not build"; psql -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p33-fixture.sql" 2>&1 | tail -5; exit 2
fi
psql -q -d "$DB" -tA -c \
  "SELECT '  '||count(*)||' P33 relations present' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m')"

step "1 · 20260910_0036 REFUSES outside the dispatch workflow"
expect_fail "0036 with no lane asserted"        "APPLY REFUSED" ""           "$MIG"
expect_fail "0036 with a lane of 'local'"       "APPLY REFUSED" "local"      "$MIG"

step "2 · the assertion suite (groups 0-4; applies 0036 on the staging lane)"
suite=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p33-cross-member-tests.sql" 2>&1); rc=$?
printf '%s\n' "$suite" | sed -n '/RESULTS/,$p'
if [ "$rc" -ne 0 ]; then echo "  FAIL  suite exit $rc"; fail=1; else echo "  PASS  suite exit 0"; fi

step "3 · the ROLLBACK refuses on the production lane (R-9: it reopens doors)"
expect_fail "rollback with lane = production"   "ROLLBACK REFUSED" "production" "$RB"
expect_fail "rollback with no lane asserted"    "ROLLBACK REFUSED" ""           "$RB"
psql -q -d "$DB" -tA -c \
  "SELECT CASE WHEN bool_or(has_table_privilege('anon', c.oid, 'SELECT'))
               THEN '  FAIL  a refused rollback still reopened something'
               ELSE '  PASS  after the refusals, all five are still closed to anon' END
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('judging_progression_audit','v_judging_drift',
          'entry_public_status','entry_vote_counts','entry_final_votes_legacy')"

step "4 · the ROLLBACK restores the pre-0036 state on the staging lane"
expect_ok "rollback with lane = staging" "staging" "$RB"
psql -q -d "$DB" -tA -c \
  "WITH f AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname IN ('judging_progression_audit','v_judging_drift',
                     'entry_public_status','entry_vote_counts','entry_final_votes_legacy'))
   SELECT CASE WHEN bool_and(has_table_privilege('anon', oid,'SELECT'))
               AND bool_and(has_table_privilege('authenticated', oid,'SELECT'))
               AND bool_and(has_table_privilege('service_role', oid,'SELECT'))
          THEN '  PASS  anon, authenticated and service_role all read the five again'
          ELSE '  FAIL  the rollback did not restore all three grantees' END FROM f
   UNION ALL
   SELECT CASE WHEN (SELECT count(*) FROM f JOIN pg_class c ON c.oid=f.oid,
                          LATERAL aclexplode(c.relacl) a WHERE a.grantee = 0) = 0
          THEN '  PASS  zero PUBLIC ACL entries — restored by name, not TO PUBLIC (F-62)'
          ELSE '  FAIL  a PUBLIC ACL entry appeared' END"

step "5 · the ROLLBACK refuses when there is nothing to undo"
expect_fail "rollback run a second time" "P33-0036-RB-PRE-002" "staging" "$RB"

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
