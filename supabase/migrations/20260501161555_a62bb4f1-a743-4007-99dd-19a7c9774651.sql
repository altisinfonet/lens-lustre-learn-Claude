-- Phase 2 / Finding #5 — F5-C-2: Strict cleanup of judge_decisions.decision CHECK
-- Pre-flight (already proven via supabase--read_query 2026-05-01):
--   • 0 live rows use 'qualified','finalist','skip','needs_review',
--     'shortlisted_final','not_selected_final'
--   • Sole writer (supabase/functions/submit-judge-decision/index.ts L160)
--     writes stage.decision_token from v3_stage_catalog
--
-- Aligns CHECK ⊆ v3_stage_catalog (active ∪ retired) so:
--   1. New R4 award tokens (top_50, top_100, finalist_only) can persist.
--   2. Legacy ghost tokens (qualified, finalist, skip, needs_review)
--      are blocked from re-introduction.
--   3. Historical back-compat tokens (not_selected_final, shortlisted_final)
--      stay valid for any future re-inserts.

ALTER TABLE public.judge_decisions
  DROP CONSTRAINT IF EXISTS judge_decisions_decision_check;

ALTER TABLE public.judge_decisions
  ADD CONSTRAINT judge_decisions_decision_check_v2
  CHECK (decision = ANY (ARRAY[
    -- Active catalog tokens (R1)
    'accept'::text,
    'reject'::text,
    'shortlist'::text,
    'needs_verification'::text,
    -- Active catalog tokens (R2)
    'qualified_r3'::text,
    -- Active catalog tokens (R3)
    'qualified_final'::text,
    -- Active catalog tokens (R4 awards — Finding #1+2+3 per-tag tokens)
    'winner'::text,
    'runner_up_1'::text,
    'runner_up_2'::text,
    'honorary_mention'::text,
    'special_jury'::text,
    'top_50'::text,
    'top_100'::text,
    'finalist_only'::text,
    -- Back-compat retired tokens (catalog is_active=false; kept to allow
    -- legacy/historic decision reinserts)
    'not_selected_r3'::text,
    'not_selected_final'::text,
    'shortlisted_final'::text
  ]));

COMMENT ON CONSTRAINT judge_decisions_decision_check_v2 ON public.judge_decisions IS
  'Phase 2 / Finding #5 (F5-C-2 strict cleanup, 2026-05-01). Aligned with v3_stage_catalog.decision_token. Removed legacy: qualified, finalist, skip, needs_review.';