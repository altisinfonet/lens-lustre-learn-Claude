ALTER TABLE public.competitions DROP CONSTRAINT competitions_status_check;

ALTER TABLE public.competitions ADD CONSTRAINT competitions_status_check
  CHECK (status = ANY (ARRAY['upcoming','open','submission_open','judging','result','closed','archived']));
