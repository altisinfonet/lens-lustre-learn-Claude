-- v6.1 Correction 2 — add stage_key column + safe backfill
ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS stage_key text
    REFERENCES public.v3_stage_catalog(stage_key) ON UPDATE CASCADE;

-- One-time backfill: only fills NULLs, never overwrites
UPDATE public.competition_entries e
   SET stage_key = c.stage_key
  FROM public.v3_stage_catalog c
 WHERE e.stage_key IS NULL
   AND e.progression_decision IS NOT NULL
   AND c.is_active = true
   AND c.decision_token = e.progression_decision
   AND c.round_number = NULLIF(regexp_replace(coalesce(e.current_round,''), '\D', '', 'g'), '')::int;

CREATE INDEX IF NOT EXISTS idx_competition_entries_stage_key
  ON public.competition_entries(stage_key);