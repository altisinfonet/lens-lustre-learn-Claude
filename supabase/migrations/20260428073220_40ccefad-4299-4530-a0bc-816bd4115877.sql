-- Contain cross-round judging overwrites by making judge_scores round-aware
ALTER TABLE public.judge_scores
  ADD COLUMN IF NOT EXISTS round_number integer NOT NULL DEFAULT 1;

-- Keep round_number in the valid judging range.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'judge_scores_round_number_check'
      AND conrelid = 'public.judge_scores'::regclass
  ) THEN
    ALTER TABLE public.judge_scores
      ADD CONSTRAINT judge_scores_round_number_check
      CHECK (round_number BETWEEN 1 AND 4);
  END IF;
END $$;

-- Replace round-blind uniqueness with round-scoped uniqueness.
ALTER TABLE public.judge_scores
  DROP CONSTRAINT IF EXISTS judge_scores_entry_judge_photo_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'judge_scores_entry_judge_round_photo_key'
      AND conrelid = 'public.judge_scores'::regclass
  ) THEN
    ALTER TABLE public.judge_scores
      ADD CONSTRAINT judge_scores_entry_judge_round_photo_key
      UNIQUE (entry_id, judge_id, round_number, photo_index);
  END IF;
END $$;

-- The old trigger inferred the round from competitions.current_round and could
-- silently write/update judge_decisions for a different round when old scores were edited.
DROP TRIGGER IF EXISTS trg_auto_tier_judge_decision ON public.judge_scores;
DROP FUNCTION IF EXISTS public.auto_tier_judge_decision();

CREATE INDEX IF NOT EXISTS idx_judge_scores_entry_round_judge_photo
  ON public.judge_scores (entry_id, round_number, judge_id, photo_index);