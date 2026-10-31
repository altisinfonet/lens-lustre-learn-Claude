-- Fix Supabase linter findings: remove security-definer dependency for public profiles and tighten permissive INSERT policies

-- 1) Create a dedicated public-profile projection table (safe columns only)
CREATE TABLE IF NOT EXISTS public.profiles_public_data (
  id uuid PRIMARY KEY,
  full_name text,
  avatar_url text,
  cover_url text,
  bio text,
  portfolio_url text,
  photography_interests text[],
  facebook_url text,
  instagram_url text,
  twitter_url text,
  youtube_url text,
  website_url text,
  preferred_language text,
  is_suspended boolean,
  created_at timestamptz,
  updated_at timestamptz,
  privacy_settings jsonb,
  cover_position real,
  custom_url text,
  pronouns text,
  current_city text,
  workplace text,
  education text,
  cover_video_url text
);

ALTER TABLE public.profiles_public_data ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.profiles_public_data TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view public profile data" ON public.profiles_public_data;
CREATE POLICY "Anyone can view public profile data"
ON public.profiles_public_data
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Admins can manage public profile data" ON public.profiles_public_data;
CREATE POLICY "Admins can manage public profile data"
ON public.profiles_public_data
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2) Keep the projection table in sync with profiles
CREATE OR REPLACE FUNCTION public.sync_profiles_public_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profiles_public_data WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.profiles_public_data (
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
    custom_url,
    pronouns,
    current_city,
    workplace,
    education,
    cover_video_url
  ) VALUES (
    NEW.id,
    NEW.full_name,
    NEW.avatar_url,
    NEW.cover_url,
    NEW.bio,
    NEW.portfolio_url,
    NEW.photography_interests,
    NEW.facebook_url,
    NEW.instagram_url,
    NEW.twitter_url,
    NEW.youtube_url,
    NEW.website_url,
    NEW.preferred_language,
    NEW.is_suspended,
    NEW.created_at,
    NEW.updated_at,
    NEW.privacy_settings,
    NEW.cover_position,
    NEW.custom_url,
    NEW.pronouns,
    NEW.current_city,
    NEW.workplace,
    NEW.education,
    NEW.cover_video_url
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    cover_url = EXCLUDED.cover_url,
    bio = EXCLUDED.bio,
    portfolio_url = EXCLUDED.portfolio_url,
    photography_interests = EXCLUDED.photography_interests,
    facebook_url = EXCLUDED.facebook_url,
    instagram_url = EXCLUDED.instagram_url,
    twitter_url = EXCLUDED.twitter_url,
    youtube_url = EXCLUDED.youtube_url,
    website_url = EXCLUDED.website_url,
    preferred_language = EXCLUDED.preferred_language,
    is_suspended = EXCLUDED.is_suspended,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    privacy_settings = EXCLUDED.privacy_settings,
    cover_position = EXCLUDED.cover_position,
    custom_url = EXCLUDED.custom_url,
    pronouns = EXCLUDED.pronouns,
    current_city = EXCLUDED.current_city,
    workplace = EXCLUDED.workplace,
    education = EXCLUDED.education,
    cover_video_url = EXCLUDED.cover_video_url;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profiles_public_data_trg ON public.profiles;
CREATE TRIGGER sync_profiles_public_data_trg
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profiles_public_data();

-- 3) Backfill existing rows
INSERT INTO public.profiles_public_data (
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
  custom_url,
  pronouns,
  current_city,
  workplace,
  education,
  cover_video_url
)
SELECT
  p.id,
  p.full_name,
  p.avatar_url,
  p.cover_url,
  p.bio,
  p.portfolio_url,
  p.photography_interests,
  p.facebook_url,
  p.instagram_url,
  p.twitter_url,
  p.youtube_url,
  p.website_url,
  p.preferred_language,
  p.is_suspended,
  p.created_at,
  p.updated_at,
  p.privacy_settings,
  p.cover_position,
  p.custom_url,
  p.pronouns,
  p.current_city,
  p.workplace,
  p.education,
  p.cover_video_url
FROM public.profiles p
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  avatar_url = EXCLUDED.avatar_url,
  cover_url = EXCLUDED.cover_url,
  bio = EXCLUDED.bio,
  portfolio_url = EXCLUDED.portfolio_url,
  photography_interests = EXCLUDED.photography_interests,
  facebook_url = EXCLUDED.facebook_url,
  instagram_url = EXCLUDED.instagram_url,
  twitter_url = EXCLUDED.twitter_url,
  youtube_url = EXCLUDED.youtube_url,
  website_url = EXCLUDED.website_url,
  preferred_language = EXCLUDED.preferred_language,
  is_suspended = EXCLUDED.is_suspended,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  privacy_settings = EXCLUDED.privacy_settings,
  cover_position = EXCLUDED.cover_position,
  custom_url = EXCLUDED.custom_url,
  pronouns = EXCLUDED.pronouns,
  current_city = EXCLUDED.current_city,
  workplace = EXCLUDED.workplace,
  education = EXCLUDED.education,
  cover_video_url = EXCLUDED.cover_video_url;

-- 4) Rebuild public view on the projection table and force invoker semantics
CREATE OR REPLACE VIEW public.profiles_public AS
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
  custom_url,
  pronouns,
  current_city,
  workplace,
  education,
  cover_video_url
FROM public.profiles_public_data;

ALTER VIEW public.profiles_public SET (security_invoker = true);

-- 5) Replace permissive INSERT policies that used WITH CHECK (true)
DROP POLICY IF EXISTS "Anyone can insert impressions" ON public.ad_impressions;
CREATE POLICY "Validated impression inserts"
ON public.ad_impressions
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(slot_id) BETWEEN 1 AND 120
  AND placement = ANY (ARRAY['header','sidebar','in-content','between-entries','lightbox-overlay','above-journal','below-journal'])
  AND event_type = ANY (ARRAY['impression','click'])
  AND device = ANY (ARRAY['desktop','mobile','tablet'])
  AND ad_source = ANY (ARRAY['internal','adsense'])
  AND (country IS NULL OR char_length(country) BETWEEN 2 AND 100)
);

DROP POLICY IF EXISTS "Anyone can insert profile views" ON public.profile_views;
CREATE POLICY "Validated profile view inserts"
ON public.profile_views
FOR INSERT
TO public
WITH CHECK (
  profile_id IS NOT NULL
  AND (viewer_id IS NULL OR viewer_id = auth.uid())
);

DROP POLICY IF EXISTS "System can insert notifications" ON public.user_notifications;
CREATE POLICY "Admins can insert notifications"
ON public.user_notifications
FOR INSERT
TO authenticated
WITH CHECK (
  user_id IS NOT NULL
  AND has_role(auth.uid(), 'admin'::app_role)
);