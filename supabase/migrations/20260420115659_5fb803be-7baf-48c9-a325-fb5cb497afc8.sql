-- Phase 2.1: Judging Decision Integrity
-- 1) Add progression_decision column on competition_entries
ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS progression_decision text;

COMMENT ON COLUMN public.competition_entries.progression_decision IS
  'Deterministic SOW-priority aggregated decision per round (shortlisted > qualified/accept > needs_review > reject). Distinct from status (lifecycle).';

CREATE INDEX IF NOT EXISTS idx_competition_entries_progression_decision
  ON public.competition_entries (progression_decision);

-- 2) Add CHECK constraint for valid progression_decision values
ALTER TABLE public.competition_entries
  DROP CONSTRAINT IF EXISTS progression_decision_valid;

ALTER TABLE public.competition_entries
  ADD CONSTRAINT progression_decision_valid
  CHECK (progression_decision IS NULL OR progression_decision IN (
    'shortlisted', 'qualified', 'accept', 'needs_review', 'reject', 'winner', 'finalist'
  ));