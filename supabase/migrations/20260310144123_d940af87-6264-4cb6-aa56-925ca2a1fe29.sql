
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
  privacy_settings
FROM public.profiles;
