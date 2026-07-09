
-- Feature flags table
CREATE TABLE IF NOT EXISTS public.system_flags (
  key TEXT PRIMARY KEY,
  value BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;

-- Anyone can read flags (needed by edge functions + frontend)
CREATE POLICY "Anyone can read flags" ON public.system_flags FOR SELECT USING (true);

-- Only admins can modify flags
CREATE POLICY "Admins can manage flags" ON public.system_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Insert initial flags
INSERT INTO public.system_flags (key, value) VALUES
  ('enable_sow_round_logic', FALSE),
  ('enable_sow_top_n', FALSE),
  ('enable_sow_round4_criteria', FALSE),
  ('enforce_strict_round_lock', FALSE)
ON CONFLICT (key) DO NOTHING;

-- Helper function to check a flag
CREATE OR REPLACE FUNCTION public.get_flag(flag_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE val BOOLEAN;
BEGIN
  SELECT value INTO val FROM public.system_flags WHERE key = flag_key;
  RETURN COALESCE(val, FALSE);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Round snapshots table for recovery system
CREATE TABLE IF NOT EXISTS public.round_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  snapshot_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.round_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage snapshots" ON public.round_snapshots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Round 4 criteria columns on judge_scores (additive, nullable)
ALTER TABLE public.judge_scores
  ADD COLUMN IF NOT EXISTS line_score INT,
  ADD COLUMN IF NOT EXISTS shape_score INT,
  ADD COLUMN IF NOT EXISTS form_score INT,
  ADD COLUMN IF NOT EXISTS texture_score INT,
  ADD COLUMN IF NOT EXISTS space_score INT,
  ADD COLUMN IF NOT EXISTS tone_score INT,
  ADD COLUMN IF NOT EXISTS balance_score INT,
  ADD COLUMN IF NOT EXISTS light_score INT,
  ADD COLUMN IF NOT EXISTS depth_score INT;
