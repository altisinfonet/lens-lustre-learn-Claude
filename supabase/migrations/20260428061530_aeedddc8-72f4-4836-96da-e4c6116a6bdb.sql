ALTER TABLE public.judging_tags DISABLE TRIGGER USER;

UPDATE public.judging_tags
SET label = 'Not Selected for R3'
WHERE id = 'bce0e662-76cb-4196-9798-e7d14bd1d782';

UPDATE public.judging_tags
SET label = 'Not Selected for Final'
WHERE id = '15012bbe-9d46-42e1-8e38-a639a3f5769f';

ALTER TABLE public.judging_tags ENABLE TRIGGER USER;