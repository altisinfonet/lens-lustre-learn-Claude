
-- Use security definer view intentionally: the view exposes only safe columns
-- while the base table is locked down to own-profile-only
DROP VIEW IF EXISTS public.profiles_public;

CREATE VIEW public.profiles_public
WITH (security_invoker=off)
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
