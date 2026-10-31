DROP POLICY "Users can update own metadata only" ON public.competition_entries;

CREATE POLICY "Users can update own metadata only"
ON public.competition_entries
FOR UPDATE
TO public
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND NOT (status               IS DISTINCT FROM (SELECT ce2.status               FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (placement            IS DISTINCT FROM (SELECT ce2.placement            FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (stage_key            IS DISTINCT FROM (SELECT ce2.stage_key            FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (progression_decision IS DISTINCT FROM (SELECT ce2.progression_decision FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (current_round        IS DISTINCT FROM (SELECT ce2.current_round        FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (current_round_int    IS DISTINCT FROM (SELECT ce2.current_round_int    FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_ai_generated      IS DISTINCT FROM (SELECT ce2.is_ai_generated      FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_ai_advisory       IS DISTINCT FROM (SELECT ce2.is_ai_advisory       FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (ai_detection_result  IS DISTINCT FROM (SELECT ce2.ai_detection_result  FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (exif_data            IS DISTINCT FROM (SELECT ce2.exif_data            FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_pinned            IS DISTINCT FROM (SELECT ce2.is_pinned            FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (is_trending          IS DISTINCT FROM (SELECT ce2.is_trending          FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (view_count           IS DISTINCT FROM (SELECT ce2.view_count           FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (certificate_ready    IS DISTINCT FROM (SELECT ce2.certificate_ready    FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (user_id              IS DISTINCT FROM (SELECT ce2.user_id              FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
  AND NOT (competition_id       IS DISTINCT FROM (SELECT ce2.competition_id       FROM public.competition_entries ce2 WHERE ce2.id = competition_entries.id))
);