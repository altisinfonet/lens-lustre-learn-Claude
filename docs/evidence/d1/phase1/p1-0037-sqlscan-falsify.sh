#!/usr/bin/env bash
# C-34 for the 0037 static scan. Each mutant breaks ONE property that matters on
# the PRODUCTION lane; the scan must exit non-zero and name that check.
#
#   bash docs/evidence/d1/phase1/p1-0037-sqlscan-falsify.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0037_p1_production_closure.sql"
RB="$ROOT/supabase/rollback/20260910_0037_p1_production_closure_ROLLBACK.sql"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
mutate() {
  local name="$1" which="$2" expr="$3" want="$4" out rc
  cp "$MIG" "$T/m.sql"; cp "$RB" "$T/r.sql"
  if [ "$which" = mig ]; then sed -i "$expr" "$T/m.sql"; else sed -i "$expr" "$T/r.sql"; fi
  out=$(cd "$ROOT" && python3 "$HERE/p1-0037-sqlscan.py" --mig "$T/m.sql" --rb "$T/r.sql" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then echo "  NOT FALSIFIABLE  $name — the scan still passed"; fail=1
  elif ! printf '%s' "$out" | grep -q "FAIL.*$want"; then
    echo "  WRONG CHECK      $name — failed, but not on '$want'"
    printf '%s\n' "$out" | grep FAIL | sed 's/^/        /'; fail=1
  else echo "  RED as required  $name  →  $(printf '%s' "$out" | grep -m1 "FAIL.*$want" | sed 's/^ *//')"; fi
}

echo "C-34 FALSIFICATION OF docs/evidence/d1/phase1/p1-0037-sqlscan.py"
(cd "$ROOT" && python3 "$HERE/p1-0037-sqlscan.py" >/dev/null 2>&1) \
  && echo "  PASS  control — the real files pass" || { echo "  FAIL  control"; fail=1; }
echo

mutate "the migration smuggles in a GRANT" mig \
  's|^COMMIT;|GRANT EXECUTE ON FUNCTION public.clear_custom_url() TO anon;\nCOMMIT;|' \
  'MIGRATION GRANTS NOTHING'
mutate "the migration grants TO PUBLIC" mig \
  's|^COMMIT;|GRANT EXECUTE ON FUNCTION public.clear_custom_url() TO PUBLIC;\nCOMMIT;|' \
  'GRANT ... TO PUBLIC'
mutate "the migration becomes two-lane" mig \
  "s|<> 'production'|NOT IN ('staging', 'production')|" \
  "PRODUCTION-ONLY assertion"
mutate "the migration is re-pointed at staging" mig \
  "s|<> 'production'|<> 'staging'|" \
  "PRODUCTION-ONLY assertion"
mutate "a GROUP A revoke drops PUBLIC (F-62 no-op)" mig \
  's|REVOKE EXECUTE ON FUNCTION public.claim_username(text) FROM PUBLIC, anon;|REVOKE EXECUTE ON FUNCTION public.claim_username(text) FROM anon;|' \
  'names PUBLIC'
mutate "a GROUP A function is dropped from the list" mig \
  '/REVOKE EXECUTE ON FUNCTION public.request_withdrawal(numeric,jsonb) FROM PUBLIC, anon;/d' \
  'GROUP A equals the set derived'
mutate "a GROUP B function is moved into GROUP A (authenticated survives)" mig \
  's|REVOKE EXECUTE ON FUNCTION public.set_write_path(text) FROM PUBLIC, anon, authenticated;|REVOKE EXECUTE ON FUNCTION public.set_write_path(text) FROM PUBLIC, anon;|' \
  'GROUP B equals the set derived'
mutate "a definer relation is dropped from the write revoke" mig \
  '/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.v_judging_drift FROM/d' \
  'all 11 definer relations'
mutate "the migration also revokes SELECT from a definer relation" mig \
  's|REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles_public FROM|REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles_public FROM|' \
  'SELECT is never revoked'
mutate "the migration touches postgres" mig \
  's|^COMMIT;|REVOKE EXECUTE ON FUNCTION public.clear_custom_url() FROM postgres;\nCOMMIT;|' \
  'nothing granted to or revoked from postgres'
mutate "the default-privilege statement becomes a GRANT" mig \
  's|IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;|IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;|' \
  'default-privilege statement REVOKEs'
mutate "the migration re-creates an object" mig \
  's|^COMMIT;|CREATE VIEW public.v_judging_drift_x AS SELECT 1;\nCOMMIT;|' \
  'no CREATE or DROP'
mutate "the rollback restores TO PUBLIC (R-11)" rb \
  's|GRANT EXECUTE ON FUNCTION public.claim_username(text) TO anon;|GRANT EXECUTE ON FUNCTION public.claim_username(text) TO PUBLIC;|' \
  'GRANT ... TO PUBLIC'
mutate "the rollback re-grants judging_progression_audit" rb \
  's|^GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.v_judging_drift TO anon, authenticated;|GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.judging_progression_audit TO anon, authenticated;\n\&|' \
  'judging_progression_audit is NOT re-granted'
mutate "the rollback's default-privilege statement grants PUBLIC" rb \
  's|IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;|IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;|' \
  'GRANTs to anon, not PUBLIC'
mutate "the rollback is re-pointed at staging (R-9 misapplied)" rb \
  "s|<> 'production'|<> 'staging'|" \
  "PRODUCTION-ONLY assertion"

echo
if [ "$fail" -eq 0 ]; then echo "  ALL SIXTEEN MUTANTS CAUGHT"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
