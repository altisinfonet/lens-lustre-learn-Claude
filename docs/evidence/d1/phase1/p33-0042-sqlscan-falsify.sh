#!/usr/bin/env bash
# C-34 for the 0042 static scan. Each mutant breaks ONE property; the scan must
# exit non-zero and name that check.
#
#   bash docs/evidence/d1/phase1/p33-0042-sqlscan-falsify.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0042_p33_owner_safe_round_correlation.sql"
RB="$ROOT/supabase/rollback/20260910_0042_p33_owner_safe_round_correlation_ROLLBACK.sql"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0

mutate() {
  local name="$1" which="$2" expr="$3" want="$4" out rc
  cp "$MIG" "$T/m.sql"; cp "$RB" "$T/r.sql"
  if [ "$which" = mig ]; then sed -i "$expr" "$T/m.sql"; else sed -i "$expr" "$T/r.sql"; fi
  out=$(cd "$ROOT" && python3 "$HERE/p33-0042-sqlscan.py" --mig "$T/m.sql" --rb "$T/r.sql" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then echo "  NOT FALSIFIABLE  $name — the scan still passed"; fail=1
  elif ! printf '%s' "$out" | grep -q "FAIL.*$want"; then
    echo "  WRONG CHECK      $name — failed, but not on '$want'"
    printf '%s\n' "$out" | grep FAIL | sed 's/^/        /'; fail=1
  else echo "  RED as required  $name  →  $(printf '%s' "$out" | grep -m1 "FAIL.*$want" | sed 's/^ *//')"; fi
}

echo "C-34 FALSIFICATION OF docs/evidence/d1/phase1/p33-0042-sqlscan.py"
(cd "$ROOT" && python3 "$HERE/p33-0042-sqlscan.py" >/dev/null 2>&1) \
  && echo "  PASS  control — the real files pass" || { echo "  FAIL  control"; fail=1; }
echo

mutate "migration smuggles in a GRANT" mig \
  's|^COMMIT;|GRANT SELECT ON TABLE public.judge_comments_owner_safe TO anon;\nCOMMIT;|' \
  'grants nothing'
mutate "migration smuggles in a REVOKE" mig \
  's|^COMMIT;|REVOKE SELECT ON TABLE public.judge_comments_owner_safe FROM anon;\nCOMMIT;|' \
  'revokes nothing'
mutate "migration DROPs the view first" mig \
  's|^CREATE OR REPLACE VIEW public.judge_comments_owner_safe AS|DROP VIEW public.judge_comments_owner_safe;\n&|' \
  'no DROP VIEW anywhere'
mutate "migration uses a bare CREATE VIEW" mig \
  's|^CREATE OR REPLACE VIEW public.judge_tag_assignments_owner_safe AS|CREATE VIEW public.judge_tag_assignments_owner_safe AS|' \
  'redefines exactly the two target views'
mutate "migration also redefines the out-of-scope view" mig \
  's|^CREATE OR REPLACE VIEW public.judge_comments_owner_safe AS|CREATE OR REPLACE VIEW public.judge_decisions_owner_safe AS SELECT 1 AS x;\n&|' \
  'redefines exactly the two target views'
mutate "migration loses the tag round correlation (a no-op fix)" mig \
  's|            AND crp.round_number = jta.round_number||' \
  'crp.round_number = jta.round_number'
mutate "migration loses the comment round correlation" mig \
  's|            AND crp.round_number = jr.round_number||' \
  'crp.round_number = jr.round_number'
mutate "migration loses the cross-competition correlation" mig \
  's|            AND jr.competition_id = ce.competition_id||' \
  'jr.competition_id = ce.competition_id'
mutate "migration adds a NULL round_id escape hatch" mig \
  's|          WHERE ce.id = jc.entry_id|          WHERE (jc.round_id IS NULL OR true) AND ce.id = jc.entry_id|' \
  'no .round_id IS NULL. escape hatch'
mutate "migration drops the owner check" mig \
  's|            AND ce.user_id = auth.uid()||g' \
  'keeps the owner check'
mutate "migration narrowed to one lane" mig \
  "s|NOT IN ('staging', 'production')|<> 'staging'|" \
  'TWO-LANE assertion'
mutate "C-A24 allowlist also accepts security_invoker=on (an invoker view)" mig \
  "s|'{security_invoker=false}'::text\\[\\])|'{security_invoker=false}'::text[], '{security_invoker=on}'::text[])|" \
  'precondition 3 allowlist is exactly'
mutate "C-A24 check dropped back to IS NOT NULL (refuses production again)" mig \
  "s|coalesce((SELECT reloptions FROM pg_class WHERE oid = oid_), '{}'::text\\[\\]) NOT IN (.*) THEN|(SELECT reloptions FROM pg_class WHERE oid = oid_) IS NOT NULL THEN|" \
  'precondition 3 allowlist is exactly'
mutate "migration sets security_invoker on a view" mig \
  's|^CREATE OR REPLACE VIEW public.judge_comments_owner_safe AS|CREATE OR REPLACE VIEW public.judge_comments_owner_safe WITH (security_invoker = on) AS|' \
  'does not set security_invoker'
mutate "rollback guard widened to both lanes (R-9 broken)" rb \
  "s|<> 'staging'|NOT IN ('staging', 'production')|" \
  'STAGING-ONLY guard'
mutate "rollback keeps the fix in place (a rollback that rolls nothing back)" rb \
  's|          WHERE ce.id = jta.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL));|          WHERE ce.id = jta.entry_id AND ce.user_id = auth.uid() AND crp.round_number = jta.round_number AND crp.published_at IS NOT NULL));|' \
  'restores the UNCORRELATED tag definition'
mutate "rollback drops the publication check" rb \
  's| AND crp.published_at IS NOT NULL));|));|g' \
  'keeps the publication check'

echo
if [ "$fail" -eq 0 ]; then echo "  ALL SEVENTEEN MUTANTS CAUGHT"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
