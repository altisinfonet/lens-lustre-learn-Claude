#!/usr/bin/env bash
# C-34 for the static scan. p33-0036-sqlscan.py passing on the real files is
# only evidence if it would have failed on files that were wrong. Each mutant
# below breaks ONE property; the scan must exit non-zero and name that check.
#
#   bash docs/evidence/d1/phase1/p33-0036-sqlscan-falsify.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0036_p33_definer_view_read_closure.sql"
RB="$ROOT/supabase/rollback/20260910_0036_p33_definer_view_read_closure_ROLLBACK.sql"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0

# mutate <name> <which: mig|rb> <sed-expr> <expected FAIL text>
mutate() {
  local name="$1" which="$2" expr="$3" want="$4" out rc
  cp "$MIG" "$T/m.sql"; cp "$RB" "$T/r.sql"
  if [ "$which" = mig ]; then sed -i "$expr" "$T/m.sql"; else sed -i "$expr" "$T/r.sql"; fi
  out=$(cd "$ROOT" && python3 "$HERE/p33-0036-sqlscan.py" --mig "$T/m.sql" --rb "$T/r.sql" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "  NOT FALSIFIABLE  $name — the scan still passed"; fail=1
  elif ! printf '%s' "$out" | grep -q "FAIL.*$want"; then
    echo "  WRONG CHECK      $name — failed, but not on '$want'"
    printf '%s\n' "$out" | grep FAIL | sed 's/^/        /'; fail=1
  else
    echo "  RED as required  $name  →  $(printf '%s' "$out" | grep -m1 "FAIL.*$want" | sed 's/^ *//')"
  fi
}

echo "C-34 FALSIFICATION OF docs/evidence/d1/phase1/p33-0036-sqlscan.py"
echo "control: the scan passes on the unmutated files"
(cd "$ROOT" && python3 "$HERE/p33-0036-sqlscan.py" >/dev/null 2>&1) \
  && echo "  PASS  control" || { echo "  FAIL  control — the real files do not pass"; fail=1; }
echo

mutate "migration granted to PUBLIC" mig \
  's/TO service_role;/TO PUBLIC;/' 'GRANT ... TO PUBLIC'
mutate "migration re-creates a view (F-66)" mig \
  's|^REVOKE SELECT ON TABLE public.v_judging_drift.*|CREATE OR REPLACE VIEW public.v_judging_drift AS SELECT 1;\n&|' \
  'no view definition touched'
mutate "migration adds ALTER DEFAULT PRIVILEGES" mig \
  's|^COMMIT;|ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;\nCOMMIT;|' \
  'no ALTER DEFAULT PRIVILEGES'
mutate "migration touches a KEPT relation" mig \
  's|^REVOKE SELECT ON TABLE public.entry_final_votes_legacy.*|REVOKE SELECT ON TABLE public.entry_final_votes FROM anon;\n&|' \
  'names none of the six KEPT relations'
mutate "migration revokes more than SELECT" mig \
  's|REVOKE SELECT ON TABLE public.v_judging_drift|REVOKE SELECT, DELETE ON TABLE public.v_judging_drift|' \
  'touches only SELECT'
mutate "migration narrowed to one lane" mig \
  "s|NOT IN ('staging', 'production')|<> 'staging'|" \
  'TWO-LANE assertion'
mutate "migration drops a closed relation from the body" mig \
  '/REVOKE SELECT ON TABLE public.entry_vote_counts FROM/d' \
  'all five closed relations are REVOKEd'
mutate "rollback guard widened to both lanes (R-9 broken)" rb \
  "s|<> 'staging'|NOT IN ('staging', 'production')|" \
  'STAGING-ONLY guard'
mutate "rollback restores TO PUBLIC instead of by name (F-62)" rb \
  's|TO anon, authenticated;|TO PUBLIC;|' \
  'GRANT ... TO PUBLIC'
mutate "rollback restores to one grantee only" rb \
  's|public.v_judging_drift TO anon, authenticated;|public.v_judging_drift TO anon;|' \
  'restores by grantee NAME only'
mutate "rollback drops one relation's GRANT" rb \
  '/GRANT SELECT ON TABLE public.entry_public_status TO/d' \
  'all five closed relations are GRANTed back'
mutate "rollback smuggles in a REVOKE" rb \
  's|^COMMIT;|REVOKE SELECT ON TABLE public.entry_final_votes FROM anon;\nCOMMIT;|' \
  'the rollback REVOKEs nothing'

echo
if [ "$fail" -eq 0 ]; then echo "  ALL TWELVE MUTANTS CAUGHT"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
