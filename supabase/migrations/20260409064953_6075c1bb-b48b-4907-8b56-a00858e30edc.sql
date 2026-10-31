
CREATE TABLE public.judge_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id UUID NOT NULL,
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_id UUID REFERENCES public.judging_rounds(id) ON DELETE SET NULL,
  last_entry_id UUID REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  last_entry_index INTEGER DEFAULT 0,
  elapsed_seconds INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(judge_id, competition_id)
);

ALTER TABLE public.judge_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Judges can view own sessions"
  ON public.judge_sessions FOR SELECT
  TO authenticated
  USING (judge_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Judges can insert own sessions"
  ON public.judge_sessions FOR INSERT
  TO authenticated
  WITH CHECK (judge_id = auth.uid());

CREATE POLICY "Judges can update own sessions"
  ON public.judge_sessions FOR UPDATE
  TO authenticated
  USING (judge_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.judge_sessions;
