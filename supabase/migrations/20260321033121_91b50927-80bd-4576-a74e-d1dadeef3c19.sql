-- Drop the view first, then remove column, then recreate view without privacy_settings
DROP VIEW IF EXISTS public.profiles_public;

ALTER TABLE public.profiles_public_data DROP COLUMN IF EXISTS privacy_settings;

-- Recreate view WITHOUT privacy_settings
CREATE VIEW public.profiles_public WITH (security_invoker = true) AS
SELECT
    id, full_name, avatar_url, cover_url, bio, portfolio_url,
    photography_interests, facebook_url, instagram_url, twitter_url,
    youtube_url, website_url, preferred_language, is_suspended,
    created_at, updated_at, cover_position, custom_url, pronouns,
    current_city, workplace, education, cover_video_url
FROM public.profiles_public_data;

-- Update the sync trigger to stop syncing privacy_settings
CREATE OR REPLACE FUNCTION public.sync_profiles_public_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profiles_public_data WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.profiles_public_data (
    id, full_name, avatar_url, cover_url, bio, portfolio_url,
    photography_interests, facebook_url, instagram_url, twitter_url,
    youtube_url, website_url, preferred_language, is_suspended,
    created_at, updated_at, cover_position, custom_url, pronouns,
    current_city, workplace, education, cover_video_url
  ) VALUES (
    NEW.id, NEW.full_name, NEW.avatar_url, NEW.cover_url, NEW.bio, NEW.portfolio_url,
    NEW.photography_interests, NEW.facebook_url, NEW.instagram_url, NEW.twitter_url,
    NEW.youtube_url, NEW.website_url, NEW.preferred_language, NEW.is_suspended,
    NEW.created_at, NEW.updated_at, NEW.cover_position, NEW.custom_url, NEW.pronouns,
    NEW.current_city, NEW.workplace, NEW.education, NEW.cover_video_url
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
    cover_position = EXCLUDED.cover_position,
    custom_url = EXCLUDED.custom_url,
    pronouns = EXCLUDED.pronouns,
    current_city = EXCLUDED.current_city,
    workplace = EXCLUDED.workplace,
    education = EXCLUDED.education,
    cover_video_url = EXCLUDED.cover_video_url;

  RETURN NEW;
END;
$function$;