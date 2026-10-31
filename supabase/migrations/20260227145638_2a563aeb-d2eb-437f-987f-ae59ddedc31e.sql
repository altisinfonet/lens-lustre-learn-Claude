
-- Recreate view with security_invoker to fix linter warning
DROP VIEW IF EXISTS public.profiles_public;

CREATE VIEW public.profiles_public
WITH (security_invoker=on)
AS
  SELECT
    id,
    full_name,
    avatar_url,
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
    updated_at
  FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;
