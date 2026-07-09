
-- Create a public view excluding sensitive fields
CREATE VIEW public.profiles_public
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

-- Grant access to the view
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- Replace the overly permissive "Anyone can view profiles" policy
-- with one that only allows viewing own full profile
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

CREATE POLICY "Users can view own full profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

-- Ensure admins can still read all full profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
