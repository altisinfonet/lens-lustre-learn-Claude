-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261110_0101 / 0102 photo-set backfill + swap · a LANE-SHAPED slice.
-- THROWAWAY DATABASE ONLY (scripts/db-photo-set-backfill-fixture.mjs refuses a
-- non-local host). Run with p32.lane set. Roles: ../photo-camera/00_cluster_roles.sql.
--
-- Copied exactly, because the unit depends on it:
--   * auth.uid() — Supabase's body; Supabase's DEFAULT PRIVILEGES (F-66);
--   * has_role() — the production body (user_roles.role is text);
--   * media_derivative_worker_ok() — the 20261029_0100 body;
--   * moderate_post_content() and enforce_post_caption_only_update() — the
--     production bodies, as BEFORE triggers on posts (the swap's UPDATE meets them).
-- Reduced: video_is_converter() → false; profiles / posts / post_media to the
-- columns the unit reads; feature_access to (feature, mode).
-- Lane shapes: each lane's photo URLs, measured 2026-11-03 (anon read of posts):
--   production — cdn.50mmretina.com post-images (-l3, -wWhH, plain, root folder),
--                avatars My Photos, Supabase storage, a v2 post, a staging-host URL;
--   staging    — cdn-staging.50mmretina.com post-images, picsum test images,
--                a production-host URL.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role::text
  )
$function$;
CREATE FUNCTION public.video_is_converter() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.media_derivative_worker_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.video_is_converter());
$fn$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, custom_url text);
CREATE TABLE public.posts (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL,
  content        text,
  privacy        text NOT NULL DEFAULT 'public',
  image_url      text,
  image_urls     text[],
  thumbnail_url  text,
  thumbnail_urls text[],
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.post_media (post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE, media_id uuid NOT NULL, ord int NOT NULL);

CREATE TABLE public.feature_access (feature text PRIMARY KEY, mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'selected', 'everyone')));
INSERT INTO public.feature_access (feature, mode) VALUES ('photo_set_v2', 'off'), ('media_ladder_feed', 'off');

CREATE TABLE public.blocked_keywords (keyword text NOT NULL, is_active boolean NOT NULL DEFAULT true, severity text NOT NULL DEFAULT 'high');
-- production body
CREATE FUNCTION public.moderate_post_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  blocked_word text;
BEGIN
  SELECT keyword INTO blocked_word
  FROM public.blocked_keywords
  WHERE is_active = true
    AND severity IN ('auto_hide', 'high', 'critical')
    AND NEW.content ILIKE '%' || keyword || '%'
  LIMIT 1;

  IF blocked_word IS NOT NULL THEN
    RAISE EXCEPTION 'Post contains restricted content and cannot be published.';
  END IF;

  RETURN NEW;
END;
$function$;
-- production body (bootstrap snapshot)
CREATE FUNCTION public.enforce_post_caption_only_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() = OLD.user_id THEN
    IF NEW.user_id        IS DISTINCT FROM OLD.user_id        OR
       NEW.image_url      IS DISTINCT FROM OLD.image_url      OR
       NEW.image_urls     IS DISTINCT FROM OLD.image_urls     OR
       NEW.thumbnail_url  IS DISTINCT FROM OLD.thumbnail_url  OR
       NEW.thumbnail_urls IS DISTINCT FROM OLD.thumbnail_urls OR
       NEW.privacy        IS DISTINCT FROM OLD.privacy        OR
       NEW.created_at     IS DISTINCT FROM OLD.created_at     THEN
      RAISE EXCEPTION 'Only the caption can be edited'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_moderate_post_content BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.moderate_post_content();
CREATE TRIGGER trg_enforce_post_caption_only_update BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.enforce_post_caption_only_update();

-- ── people ──────────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, full_name, custom_url) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Subhadeep Kumar Chattopadhyay', 'subha'),
  ('00000000-0000-4000-8000-0000000000a2', NULL, 'handle2'),
  ('00000000-0000-4000-8000-0000000000ad', 'Admin Person', 'admin');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-8000-0000000000ad', 'admin');

-- ── the lane's photos ───────────────────────────────────────────────────────
DO $lane$
DECLARE
  _h text := CASE current_setting('p32.lane', true) WHEN 'staging' THEN 'cdn-staging.50mmretina.com' ELSE 'cdn.50mmretina.com' END;
  _other text := CASE current_setting('p32.lane', true) WHEN 'staging' THEN 'cdn.50mmretina.com' ELSE 'cdn-staging.50mmretina.com' END;
  _a text := '00000000-0000-4000-8000-0000000000a1';
  _b text := '00000000-0000-4000-8000-0000000000a2';
  _base text;
BEGIN
  _base := 'https://' || _h || '/post-images/';
  -- F1 · one -l3 photo, singletons set (newest upload shape)
  INSERT INTO public.posts (id, user_id, content, image_url, image_urls, thumbnail_url, thumbnail_urls) VALUES
   ('00000000-0000-4000-8000-0000000000f1', _a::uuid, 'f1',
    _base || _a || '/posts/1793-aa-w2170h1479-l3.webp',
    ARRAY[_base || _a || '/posts/1793-aa-w2170h1479-l3.webp'],
    _base || _a || '/posts/1793-aa-w2170h1479-l3-thumb.webp',
    ARRAY[_base || _a || '/posts/1793-aa-w2170h1479-l3-thumb.webp']);
  -- F2 · two photos: a -wWhH name and a root-folder name, query string on one
  INSERT INTO public.posts (id, user_id, content, image_urls, thumbnail_urls) VALUES
   ('00000000-0000-4000-8000-0000000000f2', _b::uuid, 'f2',
    ARRAY[_base || _b || '/posts/e4c9-0-w1080h719.webp?v=2', _base || _b || '/1775573669531_0.webp'],
    ARRAY[_base || _b || '/posts/e4c9-0-w1080h719-thumb.webp', _base || _b || '/1775573669531_0_thumb.webp']);
  -- F3 · mixed: one old photo + one My Photos file in the avatars bucket (out of scope)
  INSERT INTO public.posts (id, user_id, content, image_urls, thumbnail_urls) VALUES
   ('00000000-0000-4000-8000-0000000000f3', _a::uuid, 'f3',
    ARRAY['https://' || _h || '/avatars/' || _a || '/my-photos/x/1788-jb.webp', _base || _a || '/posts/1786-js.webp'],
    ARRAY['https://' || _h || '/avatars/' || _a || '/my-photos/x/1788-jb-thumb.webp', _base || _a || '/posts/1786-js-thumb.webp']);
  -- F4 · Supabase storage only (out of scope) · F5 · already v2 (out of scope) · F8 · the other lane's host
  INSERT INTO public.posts (id, user_id, content, image_urls) VALUES
   ('00000000-0000-4000-8000-0000000000f4', _a::uuid, 'f4', ARRAY['https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/' || _a || '/1775128354335_0.webp']),
   ('00000000-0000-4000-8000-0000000000f5', _a::uuid, 'f5', ARRAY[_base || _a || '/posts/new-w2048h1365-l4.webp']),
   ('00000000-0000-4000-8000-0000000000f8', _a::uuid, 'f8', ARRAY['https://' || _other || '/post-images/' || _a || '/posts/elsewhere.webp']);
  -- F6 · an old photo whose caption a keyword added LATER refuses on UPDATE (the swap must skip it, then take it)
  INSERT INTO public.posts (id, user_id, content, image_urls, thumbnail_urls) VALUES
   ('00000000-0000-4000-8000-0000000000f6', _a::uuid, 'caption with zzbadword', ARRAY[_base || _a || '/posts/f6.webp'], ARRAY[_base || _a || '/posts/f6-thumb.webp']);
  -- F7 · an old photo with NO thumbnail_urls at all
  INSERT INTO public.posts (id, user_id, content, image_urls) VALUES
   ('00000000-0000-4000-8000-0000000000f7', _b::uuid, 'f7', ARRAY[_base || _b || '/posts/f7-w600h400.webp']);
  IF current_setting('p32.lane', true) = 'staging' THEN
    INSERT INTO public.posts (id, user_id, content, image_urls) VALUES
     ('00000000-0000-4000-8000-0000000000f9', _b::uuid, 'f9', ARRAY['https://picsum.photos/seed/50mm-staging-2/1200/800']);
  END IF;
  -- a media-graph-only post (S3 ladder, not this backfill)
  INSERT INTO public.posts (id, user_id, content, image_urls) VALUES ('00000000-0000-4000-8000-0000000000fa', _a::uuid, 'fa', '{}');
  INSERT INTO public.post_media (post_id, media_id, ord) VALUES ('00000000-0000-4000-8000-0000000000fa', gen_random_uuid(), 0);
END
$lane$;
INSERT INTO public.blocked_keywords (keyword) VALUES ('zzbadword');
