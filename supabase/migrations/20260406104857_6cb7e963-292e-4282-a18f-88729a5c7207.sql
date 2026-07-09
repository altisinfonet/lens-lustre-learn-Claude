ALTER TABLE public.judging_tags ADD COLUMN IF NOT EXISTS visible_in_round INTEGER[] DEFAULT NULL;

COMMENT ON COLUMN public.judging_tags.visible_in_round IS 'Array of round numbers (1-4) where this tag is visible. NULL means visible in all rounds.';