ALTER TABLE public.competition_entries
  ADD COLUMN current_round_int int
  GENERATED ALWAYS AS (
    NULLIF(regexp_replace(COALESCE(current_round,''), '\D', '', 'g'), '')::int
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_competition_entries_current_round_int
  ON public.competition_entries(current_round_int);