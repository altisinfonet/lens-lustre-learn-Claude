ALTER TABLE public.judge_scores
  ALTER COLUMN score TYPE numeric(4,2) USING score::numeric,
  ALTER COLUMN line_score TYPE numeric(4,2) USING line_score::numeric,
  ALTER COLUMN shape_score TYPE numeric(4,2) USING shape_score::numeric,
  ALTER COLUMN form_score TYPE numeric(4,2) USING form_score::numeric,
  ALTER COLUMN texture_score TYPE numeric(4,2) USING texture_score::numeric,
  ALTER COLUMN space_score TYPE numeric(4,2) USING space_score::numeric,
  ALTER COLUMN tone_score TYPE numeric(4,2) USING tone_score::numeric,
  ALTER COLUMN balance_score TYPE numeric(4,2) USING balance_score::numeric,
  ALTER COLUMN light_score TYPE numeric(4,2) USING light_score::numeric,
  ALTER COLUMN depth_score TYPE numeric(4,2) USING depth_score::numeric;