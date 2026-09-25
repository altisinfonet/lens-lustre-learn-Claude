#!/usr/bin/env bash
# C-34 for the 0043 static scan. Each mutant breaks ONE property; the scan must
# exit non-zero and name that check.
#
#   bash docs/evidence/d1/phase1/p32-0043-sqlscan-falsify.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0043_p32_default_privilege_recurrence.sql"
RB="$ROOT/supabase/rollback/20260910_0043_p32_default_privilege_recurrence_ROLLBACK.sql"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
mutate() {
  local name="$1" which="$2" expr="$3" want="$4" out rc
  cp "$MIG" "$T/m.sql"; cp "$RB" "$T/r.sql"
  if [ "$which" = mig ]; then sed -i "$expr" "$T/m.sql"; else sed -i "$expr" "$T/r.sql"; fi
  out=$(cd "$ROOT" && python3 "$HERE/p32-0043-sqlscan.py" --mig "$T/m.sql" --rb "$T/r.sql" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then echo "  NOT FALSIFIABLE  $name — the scan still passed"; fail=1
  elif ! printf '%s' "$out" | grep -q "FAIL.*$want"; then
    echo "  WRONG CHECK      $name — failed, but not on '$want'"
    printf '%s\n' "$out" | grep FAIL | sed 's/^/        /'; fail=1
  else echo "  RED as required  $name  →  $(printf '%s' "$out" | grep -m1 "FAIL.*$want" | sed 's/^ *//')"; fi
}

echo "C-34 FALSIFICATION OF docs/evidence/d1/phase1/p32-0043-sqlscan.py"
(cd "$ROOT" && python3 "$HERE/p32-0043-sqlscan.py" >/dev/null 2>&1) \
  && echo "  PASS  control — the real files pass" || { echo "  FAIL  control"; fail=1; }
echo

mutate "the GLOBAL statement is deleted (the file becomes a no-op)" mig \
  '/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;$/d' \
  'exactly three ALTER DEFAULT PRIVILEGES'
mutate "the carve-out loses its schema scope (global TO PUBLIC)" mig \
  's|IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO PUBLIC;|GRANT EXECUTE ON FUNCTIONS TO PUBLIC;|' \
  'exactly one TO PUBLIC, and it is the extensions carve-out'
mutate "a second TO PUBLIC is added, scoped elsewhere" mig \
  's|^COMMIT;|ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;\nCOMMIT;|' \
  'exactly one TO PUBLIC, and it is the extensions carve-out'
mutate "the statements are reordered" mig \
  's|^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO PUBLIC;|-- moved|' \
  'exactly three ALTER DEFAULT PRIVILEGES'
mutate "an object-level GRANT is smuggled in" mig \
  's|^COMMIT;|GRANT EXECUTE ON FUNCTION public.p32_0043_probe(text) TO anon;\nCOMMIT;|' \
  'no object-level GRANT or REVOKE'
mutate "an object-level REVOKE is smuggled in" mig \
  's|^COMMIT;|REVOKE EXECUTE ON FUNCTION public.p32_0043_probe(text) FROM anon;\nCOMMIT;|' \
  'no object-level GRANT or REVOKE'
mutate "a real CREATE is added" mig \
  's|^COMMIT;|CREATE TABLE public._p32_leftover (id int);\nCOMMIT;|' \
  'no executable CREATE or DROP statement'
mutate "the migration is narrowed to one lane" mig \
  "s|NOT IN ('staging', 'production')|<> 'staging'|" \
  'TWO-LANE assertion'
mutate "the probe is never dropped" mig \
  "s|EXECUTE 'DROP FUNCTION public._p32r_probe()';||" \
  'creates the probe function and DROPs it'
mutate "the migration probe loses its search_path pin (C-A22)" mig \
  "s|SECURITY DEFINER SET search_path = '''' AS|SECURITY DEFINER AS|" \
  'pins search_path'
mutate "the rollback probe loses its search_path pin (C-A22)" rb \
  "s|SECURITY DEFINER SET search_path = '''' AS|SECURITY DEFINER AS|" \
  'pins search_path'
mutate "the rollback restores TO PUBLIC (F-62, R-11)" rb \
  's|GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;|GRANT EXECUTE ON FUNCTIONS TO PUBLIC;|' \
  'no TO PUBLIC anywhere'
mutate "the rollback removes the extensions carve-out" rb \
  's|^COMMIT;|ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;\nCOMMIT;|' \
  'does not touch the extensions carve-out'
mutate "the rollback guard is widened to both lanes (R-9 broken)" rb \
  "s|<> 'staging'|NOT IN ('staging', 'production')|" \
  'STAGING-ONLY guard'

echo
if [ "$fail" -eq 0 ]; then echo "  ALL FOURTEEN MUTANTS CAUGHT"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
