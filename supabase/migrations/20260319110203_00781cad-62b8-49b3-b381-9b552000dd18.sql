
-- Add custom_url column for vanity profile URLs
ALTER TABLE public.profiles ADD COLUMN custom_url text;

-- Create unique index (case-insensitive)
CREATE UNIQUE INDEX profiles_custom_url_unique ON public.profiles (lower(custom_url)) WHERE custom_url IS NOT NULL;

-- Drop and recreate view with correct column order + new column
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public AS
SELECT
  id,
  full_name,
  avatar_url,
  cover_url,
  bio,
  portfolio_url,
  photography_interests,
  facebook_url,
  instagram_url,
  twitter_url,
  youtube_url,
  website_url,
  preferred_language,
  is_suspended,
  created_at,
  updated_at,
  privacy_settings,
  cover_position,
  custom_url
FROM public.profiles;
