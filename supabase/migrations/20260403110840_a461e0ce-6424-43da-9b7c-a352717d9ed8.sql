-- Add multi-criteria scoring columns to judge_scores
ALTER TABLE public.judge_scores 
  ADD COLUMN IF NOT EXISTS composition_score numeric,
  ADD COLUMN IF NOT EXISTS color_palette_score numeric,
  ADD COLUMN IF NOT EXISTS technique_score numeric;

-- Allow judges to create quality tags on the fly
ALTER TABLE public.judging_tags 
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS is_quality_tag boolean DEFAULT false;

-- RLS: Allow judges to insert new quality tags
CREATE POLICY "Judges can create quality tags"
  ON public.judging_tags
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'judge') OR public.has_role(auth.uid(), 'admin')
  );