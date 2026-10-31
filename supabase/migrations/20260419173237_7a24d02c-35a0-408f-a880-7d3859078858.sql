CREATE POLICY "Entry owners can view own photo decisions"
ON public.judge_decisions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.competition_entries ce
    WHERE ce.id = judge_decisions.entry_id
      AND ce.user_id = auth.uid()
  )
);