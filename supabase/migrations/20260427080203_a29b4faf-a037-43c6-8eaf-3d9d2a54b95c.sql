INSERT INTO public.system_tag_decision_map (tag_id, round_number, decision)
SELECT t.id,
       (SELECT min(r) FROM unnest(t.visible_in_round) AS r) AS round_number,
       'needs_review'::text
FROM public.judging_tags t
WHERE t.is_system = true
  AND lower(trim(t.label)) IN ('needs review', 'needs_review')
  AND t.visible_in_round IS NOT NULL
  AND array_length(t.visible_in_round, 1) >= 1
ON CONFLICT (tag_id) DO UPDATE
  SET decision = EXCLUDED.decision,
      round_number = EXCLUDED.round_number;

-- Backfill judge_decisions for any existing Needs Review tag assignments.
INSERT INTO public.judge_decisions
  (entry_id, judge_id, round_number, photo_index, decision, created_at, updated_at)
SELECT jta.entry_id,
       jta.judge_id,
       m.round_number,
       COALESCE(jta.photo_index, 0),
       m.decision,
       now(),
       now()
FROM public.judge_tag_assignments jta
JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
WHERE m.decision = 'needs_review'
ON CONFLICT (entry_id, judge_id, round_number, photo_index)
  DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();