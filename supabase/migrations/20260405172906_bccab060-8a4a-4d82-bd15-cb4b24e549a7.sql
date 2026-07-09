
-- Add Round 4 criteria columns to judge_scores
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS line_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS shape_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS form_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS texture_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS space_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS tone_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS balance_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS light_score INTEGER;
ALTER TABLE public.judge_scores ADD COLUMN IF NOT EXISTS depth_score INTEGER;

-- Create round_snapshots table for recovery system
CREATE TABLE IF NOT EXISTS public.round_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID REFERENCES public.competitions(id) ON DELETE CASCADE NOT NULL,
  round_number INTEGER NOT NULL,
  snapshot_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS for round_snapshots: only admins can read/write
ALTER TABLE public.round_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage round snapshots"
  ON public.round_snapshots
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Add validation trigger for new criteria columns
CREATE OR REPLACE FUNCTION public.validate_judge_criteria_scores()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.line_score IS NOT NULL AND (NEW.line_score < 0 OR NEW.line_score > 10) THEN
    RAISE EXCEPTION 'Line score must be between 0 and 10';
  END IF;
  IF NEW.shape_score IS NOT NULL AND (NEW.shape_score < 0 OR NEW.shape_score > 10) THEN
    RAISE EXCEPTION 'Shape score must be between 0 and 10';
  END IF;
  IF NEW.form_score IS NOT NULL AND (NEW.form_score < 0 OR NEW.form_score > 10) THEN
    RAISE EXCEPTION 'Form score must be between 0 and 10';
  END IF;
  IF NEW.texture_score IS NOT NULL AND (NEW.texture_score < 0 OR NEW.texture_score > 10) THEN
    RAISE EXCEPTION 'Texture score must be between 0 and 10';
  END IF;
  IF NEW.space_score IS NOT NULL AND (NEW.space_score < 0 OR NEW.space_score > 10) THEN
    RAISE EXCEPTION 'Space score must be between 0 and 10';
  END IF;
  IF NEW.tone_score IS NOT NULL AND (NEW.tone_score < 0 OR NEW.tone_score > 10) THEN
    RAISE EXCEPTION 'Tone score must be between 0 and 10';
  END IF;
  IF NEW.balance_score IS NOT NULL AND (NEW.balance_score < 0 OR NEW.balance_score > 10) THEN
    RAISE EXCEPTION 'Balance score must be between 0 and 10';
  END IF;
  IF NEW.light_score IS NOT NULL AND (NEW.light_score < 0 OR NEW.light_score > 10) THEN
    RAISE EXCEPTION 'Light score must be between 0 and 10';
  END IF;
  IF NEW.depth_score IS NOT NULL AND (NEW.depth_score < 0 OR NEW.depth_score > 10) THEN
    RAISE EXCEPTION 'Depth score must be between 0 and 10';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_criteria_scores
  BEFORE INSERT OR UPDATE ON public.judge_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_judge_criteria_scores();
