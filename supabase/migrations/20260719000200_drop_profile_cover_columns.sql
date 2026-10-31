-- Remove the profile cover-photo feature at the DB level.
-- Step 1: rewrite the profiles -> profiles_public_data sync trigger so it no
--   longer reads/writes cover_url / cover_position / cover_video_url.
-- Step 2: drop those columns from profiles_public_data, then profiles.
-- (Frontend no longer references these columns as of the preceding deploy.)

CREATE OR REPLACE FUNCTION public.sync_profiles_public_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ps jsonb := COALESCE(NEW.privacy_settings, '{}'::jsonb);
  v_avatar     text := CASE WHEN COALESCE(ps->>'avatar','public')      = 'public' THEN NEW.avatar_url    ELSE NULL END;
  v_bio        text := CASE WHEN COALESCE(ps->>'bio','public')         = 'public' THEN NEW.bio           ELSE NULL END;
  v_interests  text[] := CASE WHEN COALESCE(ps->>'interests','public') = 'public' THEN NEW.photography_interests ELSE NULL END;
  v_portfolio  text := CASE WHEN COALESCE(ps->>'portfolio','public')   = 'public' THEN NEW.portfolio_url ELSE NULL END;
  v_fb         text := CASE WHEN COALESCE(ps->>'social_links','public')= 'public' THEN NEW.facebook_url  ELSE NULL END;
  v_ig         text := CASE WHEN COALESCE(ps->>'social_links','public')= 'public' THEN NEW.instagram_url ELSE NULL END;
  v_tw         text := CASE WHEN COALESCE(ps->>'social_links','public')= 'public' THEN NEW.twitter_url   ELSE NULL END;
  v_yt         text := CASE WHEN COALESCE(ps->>'social_links','public')= 'public' THEN NEW.youtube_url   ELSE NULL END;
  v_web        text := CASE WHEN COALESCE(ps->>'social_links','public')= 'public' THEN NEW.website_url   ELSE NULL END;
  v_city       text := CASE WHEN COALESCE(ps->>'city_country','public')= 'public' THEN NEW.current_city  ELSE NULL END;
  v_workplace  text := CASE WHEN COALESCE(ps->>'workplace','public')   = 'public' THEN NEW.workplace     ELSE NULL END;
  v_education  text := CASE WHEN COALESCE(ps->>'education','public')    = 'public' THEN NEW.education     ELSE NULL END;
  v_pronouns   text := CASE WHEN COALESCE(ps->>'pronouns','public')    = 'public' THEN NEW.pronouns      ELSE NULL END;
  -- Presence opt-out: 'off' hides active status.
  v_last_active timestamptz := CASE WHEN COALESCE(ps->>'active_status','on') = 'off' THEN NULL ELSE NEW.last_active_at END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profiles_public_data WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.profiles_public_data (
    id, full_name, avatar_url, bio, portfolio_url,
    photography_interests, facebook_url, instagram_url, twitter_url,
    youtube_url, website_url, preferred_language, is_suspended,
    created_at, updated_at, custom_url, pronouns,
    current_city, workplace, education, is_banned,
    last_active_at, notification_sound_enabled
  ) VALUES (
    NEW.id, NEW.full_name, v_avatar, v_bio, v_portfolio,
    v_interests, v_fb, v_ig, v_tw,
    v_yt, v_web, NEW.preferred_language, NEW.is_suspended,
    NEW.created_at, NEW.updated_at, NEW.custom_url, v_pronouns,
    v_city, v_workplace, v_education, NEW.is_banned,
    v_last_active, NEW.notification_sound_enabled
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
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
    custom_url = EXCLUDED.custom_url,
    pronouns = EXCLUDED.pronouns,
    current_city = EXCLUDED.current_city,
    workplace = EXCLUDED.workplace,
    education = EXCLUDED.education,
    is_banned = EXCLUDED.is_banned,
    last_active_at = EXCLUDED.last_active_at,
    notification_sound_enabled = EXCLUDED.notification_sound_enabled;

  RETURN NEW;
END;
$function$;

-- The profiles_public view exposes the cover columns and blocks the drop.
-- Postgres cannot drop middle columns via CREATE OR REPLACE VIEW, so drop and
-- recreate it (preserving security_invoker + grants) without the cover columns.
DROP VIEW IF EXISTS public.profiles_public;

ALTER TABLE public.profiles_public_data
  DROP COLUMN IF EXISTS cover_url,
  DROP COLUMN IF EXISTS cover_position,
  DROP COLUMN IF EXISTS cover_video_url;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS cover_url,
  DROP COLUMN IF EXISTS cover_position,
  DROP COLUMN IF EXISTS cover_video_url;

CREATE VIEW public.profiles_public
  WITH (security_invoker = true)
AS SELECT
    id, full_name, avatar_url, bio, portfolio_url, photography_interests,
    facebook_url, instagram_url, twitter_url, youtube_url, website_url,
    preferred_language, is_suspended, created_at, updated_at, custom_url,
    pronouns, current_city, workplace, education
  FROM public.profiles_public_data;

GRANT ALL ON public.profiles_public TO anon, authenticated, service_role;
