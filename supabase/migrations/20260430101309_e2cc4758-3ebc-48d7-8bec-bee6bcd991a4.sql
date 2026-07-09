-- Step 1.1 — Widen judge_decisions.decision CHECK constraint
-- Adds Phase R1 v3 vocabulary tokens needed by the upcoming
-- mirror_system_tag_to_decision trigger (Step 1.3) so every system tag
-- has a 1:1 lossless representation in judge_decisions.
--
-- Backwards compatible: every previously valid token remains valid.
-- Live data check (verified pre-migration): only 'accept', 'reject',
-- 'shortlist' currently appear in judge_decisions.decision.

ALTER TABLE public.judge_decisions
  DROP CONSTRAINT IF EXISTS judge_decisions_decision_check;

ALTER TABLE public.judge_decisions
  ADD CONSTRAINT judge_decisions_decision_check
  CHECK (decision = ANY (ARRAY[
    -- legacy / already-in-use (kept for back-compat)
    'accept'::text,
    'reject'::text,
    'shortlist'::text,
    'needs_review'::text,
    'qualified'::text,
    'finalist'::text,
    'winner'::text,
    'skip'::text,
    -- Phase R1 v3 progression vocabulary (R2 → R3)
    'qualified_r3'::text,
    'not_selected_r3'::text,
    -- Phase R1 v3 progression vocabulary (R3 → R4)
    'shortlisted_final'::text,
    'not_selected_final'::text,
    -- Phase R1 v3 R4 award vocabulary
    'runner_up_1'::text,
    'runner_up_2'::text,
    'honorary_mention'::text,
    'special_jury'::text
  ]));

COMMENT ON CONSTRAINT judge_decisions_decision_check ON public.judge_decisions IS
  'Phase R1 Step 1.1 (2026-04-30): widened to include v3 progression + R4 award tokens. Mirror trigger (Step 1.3) writes these values.';