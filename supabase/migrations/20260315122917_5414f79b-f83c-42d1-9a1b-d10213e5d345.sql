-- Allow users to view judge scores on their own competition entries
CREATE POLICY "Users can view scores on own entries"
ON public.judge_scores
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.competition_entries
    WHERE competition_entries.id = judge_scores.entry_id
      AND competition_entries.user_id = auth.uid()
  )
);