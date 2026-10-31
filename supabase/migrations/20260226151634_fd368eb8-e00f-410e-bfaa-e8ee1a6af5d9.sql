ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}'::text[];