
-- Judge scores table: judges can score entries 1-10
CREATE TABLE public.judge_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
  feedback TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (entry_id, judge_id)
);

-- Add placement column to competition_entries
ALTER TABLE public.competition_entries 
ADD COLUMN placement TEXT DEFAULT NULL;

-- Enable RLS
ALTER TABLE public.judge_scores ENABLE ROW LEVEL SECURITY;

-- Judges can insert/update their own scores
CREATE POLICY "Judges can insert scores"
ON public.judge_scores
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'judge') AND judge_id = auth.uid()
);

CREATE POLICY "Judges can update own scores"
ON public.judge_scores
FOR UPDATE
TO authenticated
USING (judge_id = auth.uid() AND public.has_role(auth.uid(), 'judge'));

CREATE POLICY "Judges can view scores"
ON public.judge_scores
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'judge') OR public.has_role(auth.uid(), 'admin')
);

-- Admins can manage all scores
CREATE POLICY "Admins can manage scores"
ON public.judge_scores
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
