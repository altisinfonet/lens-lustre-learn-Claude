
-- Add phase and current_round to competitions
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'submission',
  ADD COLUMN IF NOT EXISTS current_round text DEFAULT NULL;

-- Add current_round to competition_entries (status already exists)
ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS current_round text DEFAULT NULL;

-- Add comments for clarity
COMMENT ON COLUMN public.competitions.phase IS 'Current phase: submission, judging, completed';
COMMENT ON COLUMN public.competitions.current_round IS 'Active judging round identifier';
COMMENT ON COLUMN public.competition_entries.current_round IS 'Round this entry is currently in';
