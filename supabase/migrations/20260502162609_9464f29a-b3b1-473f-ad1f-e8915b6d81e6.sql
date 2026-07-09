-- 1. Extend the CHECK constraint to permit 'needs_review' (R1-only by guard trigger)
ALTER TABLE public.judge_decisions
  DROP CONSTRAINT IF EXISTS judge_decisions_decision_check_v2;

ALTER TABLE public.judge_decisions
  ADD CONSTRAINT judge_decisions_decision_check_v2
  CHECK (decision = ANY (ARRAY[
    'accept','reject','shortlist','needs_review','needs_verification',
    'qualified_r3','qualified_final','shortlisted_final',
    'not_selected_r3','not_selected_final',
    'winner','runner_up_1','runner_up_2',
    'honorary_mention','special_jury','top_50','top_100','finalist_only'
  ]));

-- 2. Re-activate the catalog row for Round 1 "Needs Review" so the mirror trigger resolves it
UPDATE public.v3_stage_catalog
   SET is_active = true,
       tag_label_canonical = 'Needs Review'
 WHERE stage_key = 'r1_needs_review';

-- 3. Backfill the two orphaned NR judge_tag_assignments into judge_decisions
INSERT INTO public.judge_decisions
       (entry_id, judge_id, round_number, photo_index, decision)
SELECT jta.entry_id, jta.judge_id, jta.round_number,
       COALESCE(jta.photo_index, 0), s.decision_token
  FROM public.judge_tag_assignments jta
  JOIN public.judging_tags     t ON t.id = jta.tag_id
  JOIN public.v3_stage_catalog s ON s.is_active = true
                              AND s.round_number = jta.round_number
                              AND lower(trim(s.tag_label_canonical))
                                = lower(trim(t.label))
 WHERE t.label = 'Needs Review'
ON CONFLICT (entry_id, judge_id, round_number, photo_index)
DO UPDATE SET decision = EXCLUDED.decision;