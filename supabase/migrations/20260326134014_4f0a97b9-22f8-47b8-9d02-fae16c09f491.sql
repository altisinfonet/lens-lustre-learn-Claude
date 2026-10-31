
CREATE TABLE public.judge_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  round_number integer NOT NULL,
  decision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, judge_id, round_number)
);

ALTER TABLE public.judge_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage judge decisions"
  ON public.judge_decisions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can insert own decisions"
  ON public.judge_decisions FOR INSERT TO authenticated
  WITH CHECK (judge_id = auth.uid() AND has_role(auth.uid(), 'judge'::app_role));

CREATE POLICY "Judges can update own decisions"
  ON public.judge_decisions FOR UPDATE TO authenticated
  USING (judge_id = auth.uid() AND has_role(auth.uid(), 'judge'::app_role));

CREATE POLICY "Judges can view decisions"
  ON public.judge_decisions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'judge'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.judge_decisions IS 'Stores individual judge decisions per entry per round for consensus-based evaluation';
