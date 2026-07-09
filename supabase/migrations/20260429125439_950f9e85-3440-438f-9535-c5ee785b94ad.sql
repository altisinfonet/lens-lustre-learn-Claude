-- Phase 1 (retry with created_by): R2/R3 Three-Bucket Policy (Spec v3)

-- 1. Add the two new "Stay" system tags, owned by the same super-admin as existing system tags
INSERT INTO public.judging_tags
  (label, color, sort_order, is_active, is_system, is_quality_tag, visible_in_round, is_visible, created_by)
SELECT v.label, v.color, v.sort_order, true, true, false, v.visible, true, '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'::uuid
FROM (VALUES
  ('Stayed at R2', '#f59e0b', 18, ARRAY[2]),
  ('Stayed at R3', '#f59e0b', 19, ARRAY[3])
) AS v(label, color, sort_order, visible)
WHERE NOT EXISTS (
  SELECT 1 FROM public.judging_tags t WHERE lower(t.label) = lower(v.label)
);

-- 2. Add CHECK constraint on judge_decisions.decision to formally allow 'stay'
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.judge_decisions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%decision%'
  LOOP
    EXECUTE format('ALTER TABLE public.judge_decisions DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.judge_decisions
  ADD CONSTRAINT judge_decisions_decision_check
  CHECK (decision IN (
    'accept', 'reject', 'shortlist', 'needs_review',
    'qualified', 'finalist', 'winner', 'skip',
    'stay'
  ));

-- 3. Canonical SQL mapper (mirrors client tagLabelToDecision.ts)
CREATE OR REPLACE FUNCTION public.tag_label_to_decision(label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(trim(label))
    WHEN 'reject' THEN 'reject'
    WHEN 'rejected' THEN 'reject'
    WHEN 'accept' THEN 'accept'
    WHEN 'accepted' THEN 'accept'
    WHEN 'shortlist for r2' THEN 'shortlist'
    WHEN 'qualified for 2nd round' THEN 'shortlist'
    WHEN 'needs review' THEN NULL
    WHEN 'qualified for r3' THEN 'shortlist'
    WHEN 'qualified for round 3' THEN 'shortlist'
    WHEN 'not selected for r3' THEN 'reject'
    WHEN 'not selected for round 3' THEN 'reject'
    WHEN 'stayed at r2' THEN 'stay'
    WHEN 'shortlisted for final' THEN 'shortlist'
    WHEN 'not selected for final' THEN 'reject'
    WHEN 'stayed at r3' THEN 'stay'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.tag_label_to_decision IS
  'Maps judging tag label → judge_decisions.decision value. Phase 1 of Spec v3 three-bucket rollout.';