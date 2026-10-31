-- Phase R5 — Schema Hardening (Option C) — retry with both triggers dropped

-- 1) Constraints (idempotent)
ALTER TABLE public.competition_entries
  DROP CONSTRAINT IF EXISTS competition_entries_current_round_valid;
ALTER TABLE public.competition_entries
  ADD CONSTRAINT competition_entries_current_round_valid
  CHECK (current_round IS NULL OR current_round IN ('1','2','3','4'));

ALTER TABLE public.competitions
  DROP CONSTRAINT IF EXISTS competitions_current_round_valid;
ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_current_round_valid
  CHECK (current_round IS NULL OR current_round IN ('1','2','3','4'));

-- 2) Drop BOTH normalize triggers, then the function
DROP TRIGGER IF EXISTS trg_normalize_current_round_entries ON public.competition_entries;
DROP TRIGGER IF EXISTS trg_normalize_current_round_competitions ON public.competitions;
DROP FUNCTION IF EXISTS public.normalize_current_round();