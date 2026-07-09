ALTER TABLE public.judging_tags
ADD CONSTRAINT chk_visible_round_not_empty
CHECK (visible_in_round IS NOT NULL AND array_length(visible_in_round, 1) > 0);