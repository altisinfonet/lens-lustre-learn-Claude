
-- Add assignment mode to competitions
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS judge_assignment_mode text NOT NULL DEFAULT 'shared';

-- Table to track distributed entry assignments per judge
CREATE TABLE IF NOT EXISTS public.judge_entry_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(competition_id, judge_id, entry_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_judge_entry_assignments_judge ON public.judge_entry_assignments(judge_id, competition_id);
CREATE INDEX IF NOT EXISTS idx_judge_entry_assignments_entry ON public.judge_entry_assignments(entry_id);

-- RLS
ALTER TABLE public.judge_entry_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage judge entry assignments"
  ON public.judge_entry_assignments FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Judges can view own assignments"
  ON public.judge_entry_assignments FOR SELECT
  TO authenticated
  USING (judge_id = auth.uid() AND public.has_role(auth.uid(), 'judge'));
