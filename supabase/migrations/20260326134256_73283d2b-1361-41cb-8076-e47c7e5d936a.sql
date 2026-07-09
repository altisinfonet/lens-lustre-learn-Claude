
CREATE TABLE public.judge_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL,
  entry_id uuid REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number integer,
  action_type text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.judge_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage judge activity logs"
  ON public.judge_activity_logs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can view own activity logs"
  ON public.judge_activity_logs FOR SELECT TO authenticated
  USING (judge_id = auth.uid() AND has_role(auth.uid(), 'judge'::app_role));

CREATE POLICY "Service role can insert logs"
  ON public.judge_activity_logs FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX idx_judge_activity_logs_judge ON public.judge_activity_logs (judge_id);
CREATE INDEX idx_judge_activity_logs_entry ON public.judge_activity_logs (entry_id);
CREATE INDEX idx_judge_activity_logs_competition ON public.judge_activity_logs (competition_id);
