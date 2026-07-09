-- Allow all judges and admins to view ALL judge comments (shared panel)
DROP POLICY IF EXISTS "Judges can view own comments" ON public.judge_comments;
CREATE POLICY "Judges can view all comments"
  ON public.judge_comments
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'judge'::app_role) OR has_role(auth.uid(), 'admin'::app_role));