-- ============================================================================
-- Phase 1 (Additive) — judge_decisions.stage_key
-- ============================================================================

ALTER TABLE public.judge_decisions
  ADD COLUMN IF NOT EXISTS stage_key TEXT NULL;

COMMENT ON COLUMN public.judge_decisions.stage_key IS
  'Phase 1 additive (Option B). Canonical v3_stage_catalog.stage_key. '
  'NULL allowed during Phase 1; becomes NOT NULL + part of PK in Phase 2.';

WITH catalog_pick AS (
  SELECT DISTINCT ON (decision_token, round_number)
    decision_token, round_number, stage_key
  FROM public.v3_stage_catalog
  WHERE is_active = true
  ORDER BY decision_token, round_number, stage_key
)
UPDATE public.judge_decisions jd
SET stage_key = cp.stage_key
FROM catalog_pick cp
WHERE jd.stage_key IS NULL
  AND jd.decision = cp.decision_token
  AND jd.round_number = cp.round_number;

CREATE INDEX IF NOT EXISTS idx_judge_decisions_stage_key
  ON public.judge_decisions (entry_id, judge_id, round_number, photo_index, stage_key);

DO $$
DECLARE
  v_total bigint; v_filled bigint; v_null bigint;
BEGIN
  SELECT COUNT(*) INTO v_total  FROM public.judge_decisions;
  SELECT COUNT(*) INTO v_filled FROM public.judge_decisions WHERE stage_key IS NOT NULL;
  SELECT COUNT(*) INTO v_null   FROM public.judge_decisions WHERE stage_key IS NULL;

  INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data)
  VALUES (
    'judge_decisions',
    'PHASE1_STAGE_KEY_BACKFILL',
    'phase_1_additive',
    jsonb_build_object(
      'total_rows', v_total,
      'backfilled_rows', v_filled,
      'null_remaining', v_null,
      'ran_at', now()
    )
  );
END $$;