ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS twitter_url text DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS youtube_url text DEFAULT NULL;