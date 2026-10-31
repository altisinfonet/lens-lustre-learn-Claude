-- Allow judges to link their created tags to their assigned competitions
CREATE POLICY "Judges can link tags to assigned competitions"
ON public.competition_judging_tags
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_judges cj
    WHERE cj.competition_id = competition_judging_tags.competition_id
      AND cj.judge_id = auth.uid()
  )
);