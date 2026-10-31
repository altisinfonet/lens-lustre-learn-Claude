-- Add is_banned column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false;

-- Sync to public data view
ALTER TABLE public.profiles_public_data ADD COLUMN IF NOT EXISTS is_banned boolean DEFAULT false;

-- Update the sync trigger to include is_banned
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
    current_city, workplace, education, cover_video_url, is_banned
  ) VALUES (
    NEW.id, NEW.full_name, NEW.avatar_url, NEW.cover_url, NEW.bio, NEW.portfolio_url,
    NEW.photography_interests, NEW.facebook_url, NEW.instagram_url, NEW.twitter_url,
    NEW.youtube_url, NEW.website_url, NEW.preferred_language, NEW.is_suspended,
    NEW.created_at, NEW.updated_at, NEW.cover_position, NEW.custom_url, NEW.pronouns,
    NEW.current_city, NEW.workplace, NEW.education, NEW.cover_video_url, NEW.is_banned
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
    is_banned = EXCLUDED.is_banned;

  RETURN NEW;
END;
$function$;

-- Security definer function to check ban status (avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.is_banned(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT is_banned FROM public.profiles WHERE id = _user_id),
    false
  );
$$;

-- Block banned users from creating posts
CREATE POLICY "Banned users cannot create posts"
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned(auth.uid()));

-- Block banned users from reacting to posts
CREATE POLICY "Banned users cannot react to posts"
  ON public.post_reactions FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned(auth.uid()));

-- Block banned users from commenting on posts
CREATE POLICY "Banned users cannot comment on posts"
  ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned(auth.uid()));

-- Block banned users from image reactions
CREATE POLICY "Banned users cannot react to images"
  ON public.image_reactions FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned(auth.uid()));

-- Block banned users from image comments
CREATE POLICY "Banned users cannot comment on images"
  ON public.image_comments FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned(auth.uid()));

-- Block banned users from entry comments
CREATE POLICY "Banned users cannot comment on entries"
  ON public.comments FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned(auth.uid()));