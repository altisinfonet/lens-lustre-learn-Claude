-- Phase 2 / Findings #1+2+3 — R4 Decision Token Collision Fix (Option A + U2)
-- Date: 2026-05-01
--
-- Variant U2: uniqueness scoped to (round_number, decision_token) WHERE is_active.
-- Allows legitimate cross-round reuse of 'accept'/'reject' (R1+R2+R3 each write
-- their own judge_decisions.decision row), while blocking ANY intra-round
-- duplication (the actual audit defect).

BEGIN;

-- 1. Widen CHECK to permit the 3 new tokens
ALTER TABLE public.v3_stage_catalog
  DROP CONSTRAINT v3_stage_catalog_decision_token_chk;

ALTER TABLE public.v3_stage_catalog
  ADD CONSTRAINT v3_stage_catalog_decision_token_chk
  CHECK (decision_token = ANY (ARRAY[
    'accept'::text, 'reject'::text, 'shortlist'::text,
    'needs_review'::text, 'needs_verification'::text,
    'qualified'::text, 'qualified_final'::text, 'finalist'::text,
    'winner'::text, 'skip'::text,
    'qualified_r3'::text, 'not_selected_r3'::text,
    'shortlisted_final'::text, 'not_selected_final'::text,
    'runner_up_1'::text, 'runner_up_2'::text,
    'honorary_mention'::text, 'special_jury'::text,
    -- NEW (Phase 2 / Finding #1+2+3):
    'top_50'::text, 'top_100'::text, 'finalist_only'::text
  ]));

-- 2. UPDATE the 3 collided R4 rows to their unique tokens
UPDATE public.v3_stage_catalog SET decision_token = 'top_50'        WHERE stage_key = 'r4_top_50';
UPDATE public.v3_stage_catalog SET decision_token = 'top_100'       WHERE stage_key = 'r4_top_100';
UPDATE public.v3_stage_catalog SET decision_token = 'finalist_only' WHERE stage_key = 'r4_finalist';

-- 3. Lock it forever: within any active round, decision_token must be unique
CREATE UNIQUE INDEX v3_stage_catalog_active_round_token_uniq
  ON public.v3_stage_catalog (round_number, decision_token)
  WHERE is_active = true;

COMMIT;