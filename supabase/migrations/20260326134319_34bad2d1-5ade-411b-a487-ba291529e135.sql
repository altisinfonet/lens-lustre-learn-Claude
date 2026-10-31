
DROP POLICY "Service role can insert logs" ON public.judge_activity_logs;
CREATE POLICY "Judges can insert own activity logs"
  ON public.judge_activity_logs FOR INSERT TO authenticated
  WITH CHECK (judge_id = auth.uid() AND (has_role(auth.uid(), 'judge'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
