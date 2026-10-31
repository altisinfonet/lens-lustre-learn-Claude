-- Allow judges to clear or replace their own photo-level scores
CREATE POLICY "Judges can delete own scores"
ON public.judge_scores
FOR DELETE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
);