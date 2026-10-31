-- HOTFIX-F1-PLUS — Close judge_id leak via projected view + drop entry-owner SELECT policy
-- Mandate: /docs/forensic-engineering-mandate.md
-- Precheck: docs/fix-sprints/VERIFY-HOTFIX-F-PRECHECK.md + C1–C5 (this session)

BEGIN;

-- 1) Projected, security-invoker view — physically cannot expose judge_id
CREATE VIEW public.judge_decisions_owner_safe
WITH (security_invoker = on) AS
SELECT
  entry_id,
  photo_index,
  decision,
  round_number
FROM public.judge_decisions;

COMMENT ON VIEW public.judge_decisions_owner_safe IS
  'HOTFIX-F1-PLUS: owner-safe projection of judge_decisions (no judge_id). security_invoker=on so base-table RLS still applies. Used by SubmissionDetail per-photo derived status.';

GRANT SELECT ON public.judge_decisions_owner_safe TO authenticated;

-- 2) Drop the entry-owner SELECT policy on the base table.
--    Judges + admins keep their independent policies (verified C5).
DROP POLICY "Entry owners can view own photo decisions" ON public.judge_decisions;

-- 3) Add an owner-scoped SELECT policy that the view's security_invoker can pass through.
--    Without this, the view loses owner reads entirely; with it, owners read only the
--    4 projected columns (judge_id never reaches the wire).
CREATE POLICY "Entry owners can view own decisions via safe view"
  ON public.judge_decisions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.competition_entries ce
      WHERE ce.id = judge_decisions.entry_id
        AND ce.user_id = auth.uid()
    )
  );

COMMIT;