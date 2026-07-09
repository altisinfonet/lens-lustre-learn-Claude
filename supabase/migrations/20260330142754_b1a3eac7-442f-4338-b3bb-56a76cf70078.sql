
-- Add last_active_at to profiles for "last seen" feature
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now();

-- Add notification_sound_enabled preference
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notification_sound_enabled boolean DEFAULT true;

-- Sync last_active_at and notification_sound_enabled to profiles_public_data
ALTER TABLE public.profiles_public_data ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now();
ALTER TABLE public.profiles_public_data ADD COLUMN IF NOT EXISTS notification_sound_enabled boolean DEFAULT true;

-- Update sync trigger to include new columns
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
    current_city, workplace, education, cover_video_url, is_banned,
    last_active_at, notification_sound_enabled
  ) VALUES (
    NEW.id, NEW.full_name, NEW.avatar_url, NEW.cover_url, NEW.bio, NEW.portfolio_url,
    NEW.photography_interests, NEW.facebook_url, NEW.instagram_url, NEW.twitter_url,
    NEW.youtube_url, NEW.website_url, NEW.preferred_language, NEW.is_suspended,
    NEW.created_at, NEW.updated_at, NEW.cover_position, NEW.custom_url, NEW.pronouns,
    NEW.current_city, NEW.workplace, NEW.education, NEW.cover_video_url, NEW.is_banned,
    NEW.last_active_at, NEW.notification_sound_enabled
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
    cover_video_url = EXCLUDED.cover_video_url,
    is_banned = EXCLUDED.is_banned,
    last_active_at = EXCLUDED.last_active_at,
    notification_sound_enabled = EXCLUDED.notification_sound_enabled;

  RETURN NEW;
END;
$function$;
