ALTER TABLE public.judge_scores
  ALTER COLUMN score TYPE integer USING round(score)::integer,
  ALTER COLUMN composition_score TYPE integer USING round(composition_score)::integer,
  ALTER COLUMN color_palette_score TYPE integer USING round(color_palette_score)::integer,
  ALTER COLUMN technique_score TYPE integer USING round(technique_score)::integer,
  ALTER COLUMN line_score TYPE integer USING round(line_score)::integer,
  ALTER COLUMN shape_score TYPE integer USING round(shape_score)::integer,
  ALTER COLUMN form_score TYPE integer USING round(form_score)::integer,
  ALTER COLUMN texture_score TYPE integer USING round(texture_score)::integer,
  ALTER COLUMN space_score TYPE integer USING round(space_score)::integer,
  ALTER COLUMN tone_score TYPE integer USING round(tone_score)::integer,
  ALTER COLUMN balance_score TYPE integer USING round(balance_score)::integer,
  ALTER COLUMN light_score TYPE integer USING round(light_score)::integer,
  ALTER COLUMN depth_score TYPE integer USING round(depth_score)::integer;