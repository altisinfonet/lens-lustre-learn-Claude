BEGIN;
ALTER TABLE public.judging_tags DISABLE TRIGGER trg_protect_system_tags;

UPDATE public.judging_tags
SET visible_in_round = ARRAY[3]
WHERE id = 'df11381a-1d96-4c46-8439-747ed3a7b0c6'  -- Qualified for Final Round
  AND visible_in_round = ARRAY[4];

ALTER TABLE public.judging_tags ENABLE TRIGGER trg_protect_system_tags;
COMMIT;