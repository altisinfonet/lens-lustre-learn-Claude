
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS ai_images_allowed boolean NOT NULL DEFAULT true;

ALTER TABLE public.competition_entries ADD COLUMN IF NOT EXISTS is_ai_generated boolean NOT NULL DEFAULT false;
