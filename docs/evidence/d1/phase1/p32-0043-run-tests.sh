#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P32 · 20260910_0043 — the harness.
#
# Every apply and rollback goes through p32-0043-runit2.sh, the extracted
# "Run it" step of apply-migration.yml (R-13): one psql session,
# -c "SET p32.lane = '<lane>';" then -f.
#
# The step that matters most is 3: the SAME file with its GLOBAL statement
# removed, run on a fresh fixture, and the probe going RED. Without it, "anon
# cannot execute a new function" would be a claim about three statements with
# no evidence about which one did the work — and R-51 exists precisely because
# the per-schema statement looked like it was doing the work and was not.
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
#
#   bash docs/evidence/d1/phase1/p32-0043-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p43
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0043_p32_default_privilege_recurrence.sql"
RB="$ROOT/supabase/rollback/20260910_0043_p32_default_privilege_recurrence_ROLLBACK.sql"
RUNIT="$HERE/p32-0043-runit2.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
step() { printf '\n══ %s\n' "$*"; }

probe()  { psql -q -d "$DB" -tAc "SELECT public.p32_0043_probe()"; }
digest() { psql -q -d "$DB" -tAc "SELECT public.p32_0043_defacl_digest()"; }
build()  { dropdb --if-exists "$DB" >/dev/null 2>&1; createdb "$DB" || return 1
           psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p32-0043-fixture.sql" >/dev/null 2>&1; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" "${3:-5432}" 2>&1); rc=$?; }
expect_fail() { local what="$1" needle="$2"; run "$3" "$4" "${5:-5432}"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — ACCEPTED (exit 0). It must refuse."; fail=1
  elif ! printf '%s' "$out" | grep -q "$needle"; then
    echo "  FAIL  $what — refused, but not with '$needle':"; printf '%s\n' "$out" | sed 's/^/        /' | head -5; fail=1
  else echo "  PASS  $what — refused (exit $rc), '$needle'"; fi; }
expect_ok() { local what="$1"; run "$2" "$3" "${4:-5432}"
  if [ "$rc" -ne 0 ]; then echo "  FAIL  $what — exit $rc:"; printf '%s\n' "$out" | sed 's/^/        /' | tail -12; fail=1
  else echo "  PASS  $what"; fi; }
ck() { [ ${#1} -eq 32 ] && [ ${#2} -eq 32 ] && return 0
       echo "  FAIL  $3 — a digest was empty or malformed; the comparison proves nothing"; fail=1; return 1; }
same() { ck "$1" "$2" "$3" || return; [ "$1" = "$2" ] && echo "  PASS  $3" || { echo "  FAIL  $3 (digests differ)"; fail=1; }; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }

step "0 · the fixture: both lanes' starting shape"
psql -q -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')"
if build; then echo "  PASS  fixture built"; else echo "  FAIL  fixture did not build"; exit 2; fi
BEFORE=$(probe); D0=$(digest)
echo "  a new SECURITY DEFINER function in public is born:"
echo "      $BEFORE"
want "$(probe | sed -E 's/ acl=.*//')" "anon=t authenticated=t service_role=t" \
     "BEFORE: anon CAN execute a newly created function — this is P32's recurrence"
psql -q -d "$DB" -tA -c "SELECT '  pg_default_acl: ' || coalesce(nspname,'(GLOBAL)') || ' ' || defaclobjtype::text || ' ' || defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclrole='postgres'::regrole ORDER BY 1"

step "1 · 0043 REFUSES outside the dispatch workflow"
expect_fail "no lane asserted"          "Unknown target"  ""        "$MIG"
expect_fail "a lane of 'local'"         "Unknown target"  "local"   "$MIG"
expect_fail "transaction pooler, 6543"  "6543"            staging   "$MIG" 6543
same "$D0" "$(digest)" "three refusals left pg_default_acl unchanged"

step "2 · 0043 applies, and a new function is no longer anon-executable"
expect_ok "apply, TARGET_LANE=staging" staging "$MIG"
AFTER=$(probe); D1=$(digest)
echo "      $AFTER"
want "$(probe | sed -E 's/ acl=.*//')" "anon=f authenticated=t service_role=t" \
     "AFTER: anon CANNOT, authenticated and service_role still CAN"
psql -q -d "$DB" -tA -c "SELECT '  pg_default_acl: ' || coalesce(nspname,'(GLOBAL)') || ' ' || defaclobjtype::text || ' ' || defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclrole='postgres'::regrole ORDER BY 1"

step "3 · C-34 — the SAME file WITHOUT its global statement leaves anon open"
# This is R-51's finding, reproduced against the file rather than described:
# the per-schema statement alone is what 0037 carries, and it is not the fix.
sed '/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;$/d' \
    "$MIG" > "$T/loosened.sql"
if [ "$(grep -c '^ALTER DEFAULT' "$T/loosened.sql")" -ne 2 ]; then
  echo "  FAIL  the loosened copy does not have exactly 2 ALTER DEFAULT statements"; fail=1
fi
build
out=$(TARGET_LANE=staging bash "$RUNIT" "$DB" "$T/loosened.sql" 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then
  echo "  FAIL  NOT FALSIFIABLE — the loosened copy applied cleanly, so the global"
  echo "        statement is not what closes anon and the real file proves nothing"; fail=1
elif printf '%s' "$out" | grep -q "P32-0043-POST-005"; then
  echo "  PASS  the loosened copy is REFUSED by its own probe (P32-0043-POST-005):"
  printf '%s\n' "$out" | grep -m1 'P32-0043-POST-005' | sed 's/.*ERROR: *//; s/^/        /'
  echo "  PASS  so the GLOBAL statement — not the per-schema one — is what closes anon"
else
  echo "  FAIL  the loosened copy failed, but not on the probe:"; printf '%s\n' "$out" | tail -5 | sed 's/^/        /'; fail=1
fi
psql -q -d "$DB" -tAc "SELECT '  loosened copy, measured directly: ' || public.p32_0043_probe()"

step "4 · idempotence — a second apply changes nothing"
build; expect_ok "first apply" staging "$MIG"; D1=$(digest)
expect_ok "second apply" staging "$MIG"
same "$D1" "$(digest)" "the second apply left pg_default_acl identical"
want "$(probe | sed -E 's/ acl=.*//')" "anon=f authenticated=t service_role=t" "and the probe still reads the same"

step "5 · the extensions carve-out, and the control that shows it is needed"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions" >/dev/null 2>&1
psql -q -d "$DB" -tA -c "
  SELECT CASE WHEN has_function_privilege('anon', oid, 'EXECUTE')
         THEN '  PASS  with the carve-out: extensions.similarity is anon-executable, acl=' || coalesce(proacl::text,'NULL')
         ELSE '  FAIL  extensions.similarity is NOT anon-executable, acl=' || coalesce(proacl::text,'NULL') END
    FROM pg_proc WHERE proname='similarity' AND pronamespace='extensions'::regnamespace LIMIT 1"
# The control: the same file with statement 3 removed. If pg_trgm still came out
# anon-executable, the carve-out would be decoration and the only TO PUBLIC in
# Phase 1 would be unjustified.
sed '/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO PUBLIC;$/d' \
    "$MIG" > "$T/nocarve.sql"
build
out=$(TARGET_LANE=staging bash "$RUNIT" "$DB" "$T/nocarve.sql" 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then
  echo "  FAIL  the no-carve-out copy applied; its own postcondition should refuse it"; fail=1
else
  echo "  PASS  the no-carve-out copy is refused by P32-0043-POST-004"
fi
# and measure what it would have done to an extension, with the postcondition
# taken out of the way.
psql -q -d "$DB" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'Q'
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
Q
psql -q -d "$DB" -tA -c "
  SELECT CASE WHEN NOT has_function_privilege('anon', oid, 'EXECUTE')
         THEN '  PASS  CONTROL — without the carve-out, extensions.similarity comes out acl=' || coalesce(proacl::text,'NULL') || ' and anon CANNOT execute it'
         ELSE '  FAIL  CONTROL — the carve-out makes no difference, so it is unjustified' END
    FROM pg_proc WHERE proname='similarity' AND pronamespace='extensions'::regnamespace LIMIT 1"

step "6 · the ROLLBACK"
build; expect_ok "apply" staging "$MIG"
expect_fail "rollback on the production lane (R-9)" "ROLLBACK REFUSED" production "$RB"
expect_fail "rollback with no lane"                 "Unknown target"   ""         "$RB"
expect_ok   "rollback, TARGET_LANE=staging" staging "$RB"
want "$(probe | sed -E 's/ acl=.*//')" "anon=f authenticated=t service_role=t" \
     "after the rollback: authenticated and service_role can, anon still cannot — NARROWER than the pre-state, by design"
psql -q -d "$DB" -tA -c "
  SELECT CASE WHEN (SELECT count(*) FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
                     WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace=0 AND d.defaclobjtype='f' AND x.grantee=0)=0
         THEN '  PASS  the global entry still has no PUBLIC item — restored by name (F-62, R-11)'
         ELSE '  FAIL  the rollback re-created a PUBLIC grant' END
UNION ALL
  SELECT CASE WHEN (SELECT count(*) FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
                     WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='extensions'::regnamespace
                       AND d.defaclobjtype='f' AND x.grantee=0)=1
         THEN '  PASS  the extensions carve-out survived the rollback'
         ELSE '  FAIL  the rollback removed the carve-out and would break CREATE EXTENSION' END"
expect_fail "rollback run a second time" "P32-0043-RB-PRE" staging "$RB"

step "7 · re-applying after the rollback closes the loop"
expect_ok "apply again" staging "$MIG"
want "$(probe | sed -E 's/ acl=.*//')" "anon=f authenticated=t service_role=t" "the post-apply probe is reproduced"

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
