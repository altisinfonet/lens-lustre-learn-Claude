#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P33 · 20260910_0042 — the harness.
#
# Builds the fixture on a scratch PostgreSQL 17 cluster, runs the BEFORE/AFTER
# suite, exercises both files' refusals, and demonstrates the F-66 hazard the
# migration is written to avoid.
#
# Every apply is dispatched the way apply-migration.yml has dispatched since
# PR #293 (R-13): one psql session, `-c "SET p32.lane = '<lane>';"` then
# `-f <file>`.
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
#
#   bash docs/evidence/d1/phase1/p33-0042-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p42
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0042_p33_owner_safe_round_correlation.sql"
RB="$ROOT/supabase/rollback/20260910_0042_p33_owner_safe_round_correlation_ROLLBACK.sql"

fail=0
step() { printf '\n══ %s\n' "$*"; }

run() {  # run <lane-or-empty> <file> -> sets $out $rc
  if [ -n "$1" ]; then out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "SET p32.lane = '$1';" -f "$2" 2>&1); rc=$?
  else                 out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$2" 2>&1); rc=$?; fi
}
expect_fail() { local what="$1" needle="$2"; run "$3" "$4"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — it was ACCEPTED (exit 0). It must refuse."; fail=1
  elif ! printf '%s' "$out" | grep -q "$needle"; then
    echo "  FAIL  $what — refused, but not with '$needle':"; printf '%s\n' "$out" | sed 's/^/        /' | head -6; fail=1
  else echo "  PASS  $what — refused (exit $rc), '$needle'"; fi; }
expect_ok() { local what="$1"; run "$2" "$3"
  if [ "$rc" -ne 0 ]; then echo "  FAIL  $what — exit $rc:"; printf '%s\n' "$out" | sed 's/^/        /' | head -20; fail=1
  else echo "  PASS  $what"; fi; }

build() { dropdb --if-exists "$DB" >/dev/null 2>&1; createdb "$DB" || return 1
          psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p33-0042-fixture.sql" >/dev/null 2>&1; }

step "0 · scratch cluster and fixture"
psql -q -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')"
if build; then echo "  PASS  fixture built"; else echo "  FAIL  fixture did not build"; exit 2; fi

step "1 · 20260910_0042 REFUSES outside the dispatch workflow"
expect_fail "0042 with no lane asserted"  "APPLY REFUSED" ""      "$MIG"
expect_fail "0042 with a lane of 'local'" "APPLY REFUSED" "local" "$MIG"

step "2 · the BEFORE/AFTER suite (applies 0042 on the staging lane)"
suite=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p33-0042-tests.sql" 2>&1); rc=$?
printf '%s\n' "$suite" | sed -n '/ACL AND RELATION/,$p'
if [ "$rc" -ne 0 ]; then echo "  FAIL  suite exit $rc"; fail=1; else echo "  PASS  suite exit 0"; fi

step "3 · re-applying 0042 is a no-op, not a second change (idempotence)"
expect_ok "0042 applied a second time on the staging lane" "staging" "$MIG"
psql -q -d "$DB" -tA -c \
  "SELECT CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE n.nspname='public' AND c.relname IN ('judge_comments_owner_safe','judge_tag_assignments_owner_safe')
                        AND (SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee=0) > 0) = 0
               THEN '  PASS  still zero PUBLIC ACL entries after a second apply'
               ELSE '  FAIL  a PUBLIC ACL entry appeared' END"

step "4 · the ROLLBACK refuses on the production lane (R-9: it restores C-A19)"
expect_fail "rollback with lane = production" "ROLLBACK REFUSED" "production" "$RB"
expect_fail "rollback with no lane asserted"  "ROLLBACK REFUSED" ""           "$RB"

step "5 · the ROLLBACK restores the pre-0042 definitions on the staging lane"
expect_ok "rollback with lane = staging" "staging" "$RB"
psql -q -d "$DB" -tA <<'Q'
SELECT CASE WHEN pg_get_viewdef('public.judge_tag_assignments_owner_safe'::regclass, true)
                 !~ 'crp\.round_number = jta\.round_number'
            AND  pg_get_viewdef('public.judge_comments_owner_safe'::regclass, true)
                 !~ 'crp\.round_number = jr\.round_number'
       THEN '  PASS  both definitions are back to the pre-0042 (leaking) form'
       ELSE '  FAIL  a round correlation survived the rollback' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname='public' AND c.relname LIKE '%owner_safe'
                     AND (SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee=0) > 0) = 0
       THEN '  PASS  zero PUBLIC ACL entries after the rollback (F-66)'
       ELSE '  FAIL  the rollback re-created a view and reopened PUBLIC' END;
Q

step "6 · the ROLLBACK refuses when there is nothing to undo"
expect_fail "rollback run a second time" "P33-0042-RB-PRE-002" "staging" "$RB"

step "7 · WHY CREATE OR REPLACE — measured, not cited"
# Why the migration uses CREATE OR REPLACE. DROP the view and CREATE it again
# -- the ordinary way to change a definition -- and read what happens to the
# ACL. This runs LAST, on a database the suite has finished with.
#
# Note what it shows: PUBLIC does NOT appear. F-66 ("DROP+CREATE reopens the
# default PUBLIC grant") is a FUNCTION phenomenon -- PUBLIC holds EXECUTE by
# default -- and does not apply to tables and views, which have no built-in
# PUBLIC grant. The hazard here is the opposite one: every named grant is
# lost.
psql -q -d "$DB" -tA <<'Q'
DO $d$
DECLARE def text; acl_before text; acl_after text;
        b_anon bool; b_auth bool; b_svc bool;
        a_anon bool; a_auth bool; a_svc bool; a_pub bool;
BEGIN
  SELECT c.relacl::text INTO acl_before FROM pg_class c WHERE c.oid='public.judge_comments_owner_safe'::regclass;
  b_anon := has_table_privilege('anon','public.judge_comments_owner_safe','SELECT');
  b_auth := has_table_privilege('authenticated','public.judge_comments_owner_safe','SELECT');
  b_svc  := has_table_privilege('service_role','public.judge_comments_owner_safe','SELECT');
  def := pg_get_viewdef('public.judge_comments_owner_safe'::regclass, true);

  EXECUTE 'DROP VIEW public.judge_comments_owner_safe';
  EXECUTE 'CREATE VIEW public.judge_comments_owner_safe AS ' || def;

  SELECT c.relacl::text INTO acl_after FROM pg_class c WHERE c.oid='public.judge_comments_owner_safe'::regclass;
  a_anon := has_table_privilege('anon','public.judge_comments_owner_safe','SELECT');
  a_auth := has_table_privilege('authenticated','public.judge_comments_owner_safe','SELECT');
  a_svc  := has_table_privilege('service_role','public.judge_comments_owner_safe','SELECT');
  a_pub  := has_table_privilege('public','public.judge_comments_owner_safe','SELECT');

  RAISE NOTICE '  BEFORE DROP+CREATE  acl=%', coalesce(acl_before,'(null)');
  RAISE NOTICE '                      anon=%  authenticated=%  service_role=%', b_anon, b_auth, b_svc;
  RAISE NOTICE '  AFTER  DROP+CREATE  acl=%', coalesce(acl_after,'(null)');
  RAISE NOTICE '                      anon=%  authenticated=%  service_role=%  PUBLIC=%', a_anon, a_auth, a_svc, a_pub;

  IF a_anon OR a_auth OR a_svc THEN
    RAISE EXCEPTION '  NOT DEMONSTRATED — DROP+CREATE preserved a grant on this server';
  END IF;
  IF a_pub THEN
    RAISE EXCEPTION '  UNEXPECTED — PUBLIC gained SELECT on a re-created view on this server';
  END IF;
  RAISE NOTICE '  PASS  DROP+CREATE wiped every named grant: anon, authenticated AND';
  RAISE NOTICE '        service_role all lost SELECT, and PUBLIC did NOT gain it.';
  RAISE NOTICE '        That is why 20260910_0042 uses CREATE OR REPLACE VIEW, and it is';
  RAISE NOTICE '        NOT the hazard F-66 describes (F-66 is about functions).';
END
$d$;
Q
[ $? -ne 0 ] && fail=1

step "8 · C-A24 — production's views say security_invoker=off out loud"
# Production's owner_safe views carry reloptions {security_invoker=off}; staging
# has NULL. Same meaning — a definer view — different spelling, and 0042's
# first precondition refused the spelling (production run #98, PRE-003,
# nothing changed). Each case below builds the fixture, sets the reloption on
# both views, and dispatches.
T8="$(mktemp -d)"
# the pre-fix precondition, reconstructed from the current file so the control
# does not depend on git history: the one line C-A24 replaced.
python3 - "$MIG" "$T8/prefix.sql" <<'PYX'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
new = "IF coalesce((SELECT reloptions FROM pg_class WHERE oid = oid_), '{}'::text[]) NOT IN ('{}'::text[], '{security_invoker=off}'::text[], '{security_invoker=false}'::text[]) THEN"
old = "IF (SELECT reloptions FROM pg_class WHERE oid = oid_) IS NOT NULL THEN"
assert s.count(new) == 1, 'the C-A24 line is not in the file'
io.open(sys.argv[2], 'w', encoding='utf-8').write(s.replace(new, old))
PYX
relopt() { psql -q -d "$DB" -tAc "SELECT string_agg(coalesce(reloptions::text,'NULL'), ',' ORDER BY relname) FROM pg_class WHERE relname IN ('judge_comments_owner_safe','judge_tag_assignments_owner_safe')"; }
acls()   { psql -q -d "$DB" -tAc "SELECT string_agg(relacl::text, ' ; ' ORDER BY relname) FROM pg_class WHERE relname IN ('judge_comments_owner_safe','judge_tag_assignments_owner_safe')"; }
setopt() { build && psql -q -d "$DB" -c "ALTER VIEW public.judge_comments_owner_safe SET ($1); ALTER VIEW public.judge_tag_assignments_owner_safe SET ($1);" >/dev/null; }

setopt "security_invoker=off"
echo "  reloptions before: $(relopt)"
expect_fail "CONTROL — the pre-fix file on security_invoker=off (production run #98)" "P33-0042-PRE-003" "staging" "$T8/prefix.sql"

setopt "security_invoker=off"; A0=$(acls)
expect_ok "the fixed file on security_invoker=off" "staging" "$MIG"
[ "$(acls)" = "$A0" ] && echo "  PASS  ACL byte-identical across the apply" || { echo "  FAIL  ACL changed"; fail=1; }
[ "$(relopt)" = "NULL,NULL" ] && echo "  PASS  reloptions end NULL — the same meaning as off, and staging's spelling" || { echo "  FAIL  reloptions ended $(relopt)"; fail=1; }

# the leak is closed on the production shape: the BEFORE/AFTER suite, on a
# fixture carrying security_invoker=off. The suite applies 0042 itself and
# fails unless exactly the two leaking reads change.
setopt "security_invoker=off"
suite=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p33-0042-tests.sql" 2>&1); src=$?
if [ "$src" -eq 0 ] && printf '%s' "$suite" | grep -q 'TESTS GREEN'; then
  echo "  PASS  BEFORE/AFTER suite on security_invoker=off: 20 assertions, exactly the two leaking reads changed"
else echo "  FAIL  the suite on security_invoker=off: exit $src"; printf '%s\n' "$suite" | grep -m3 -E 'ERROR|FAIL' | sed 's/^/        /'; fail=1; fi

setopt "security_invoker=false"
expect_ok "the fixed file on security_invoker=false (the other spelling of off)" "staging" "$MIG"

for opt in "security_invoker=on" "security_invoker=true" "security_barrier=true"; do
  setopt "$opt"; B=$(relopt)
  expect_fail "still refused: $opt" "P33-0042-PRE-003" "staging" "$MIG"
  [ "$(relopt)" = "$B" ] || { echo "  FAIL  reloptions changed after a refusal"; fail=1; }
done
echo "  (security_invoker=on turns the views into invoker views, where base-table RLS applies and"
echo "   this file's premise — the grant is the only control — no longer holds. security_barrier"
echo "   is refused too: CREATE OR REPLACE would silently drop it, which is a behaviour change.)"
rm -rf "$T8"

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
