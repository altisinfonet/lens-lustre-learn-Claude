CREATE POLICY "no_self_vote"
ON public.competition_votes
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND NOT EXISTS (
    SELECT 1 FROM public.competition_entries e
    WHERE e.id = competition_votes.entry_id
      AND e.user_id = auth.uid()
  )
);