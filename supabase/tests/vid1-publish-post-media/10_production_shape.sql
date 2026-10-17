-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261013_0004 · a PRODUCTION-SHAPED slice of the schema.
-- THROWAWAY DATABASE ONLY (see 00_cluster_roles.sql).
--
-- What is copied exactly, because the unit under test depends on it:
--   * the table ACLs — posts {anon,authenticated = arwdm}; media_objects and
--     post_media: NOTHING for anon/authenticated (production relacl, collector
--     2026-10-13 06:51Z); post_videos {authenticated = ard, anon = r} and videos
--     {nothing} as VID-1 grants them on staging;
--   * the RLS policies of posts, post_media, media_objects and post_videos
--     (production / staging text), and auth.uid() (Supabase's body);
--   * can_view_post() and tg_post_videos_link_guard() bodies;
--   * Supabase's default privileges on functions in public (every new function
--     is executable by anon/authenticated/service_role — F-66), so the
--     migration's explicit REVOKEs are tested against the worst case.
-- What is reduced: columns to the ones these functions read; has_role /
-- is_banned / account_is_live / feature_allowed_me / are_friends return the
-- answer for an ordinary live member with the video feature on; the
-- rate-limit trigger is a no-op (it exists so the 20261011_0003 PROBE's
-- trigger check can run); videos_read is reduced to owner-or-ready (staging
-- also ORs an admin check and video_visible()) — the member never reads videos
-- here, the link guard does, as its owner. The other INSERT triggers both
-- lanes carry on posts are left out: all are SECURITY DEFINER except
-- enforce_post_categories(), and none of the INVOKER ones names post_media
-- (production: collector dump 2026-10-13; staging: catalog 2026-10-13).
-- The fixture's owner is a superuser; on Supabase the owner (postgres) is not,
-- but owns posts/post_media with RLS not forced and holds BYPASSRLS, so the
-- helper bypasses RLS on both — which is exactly why its WHERE is the control.
-- detect_duplicate_post() is NOT defined here: the runner installs the
-- 20261011_0002 body verbatim from that migration file, then
-- 20261011_0003 itself runs verbatim.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── auth.uid(), as Supabase defines it ───────────────────────────────────────
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

-- Supabase's default: new functions in public are executable by the API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ── policy helpers (production signatures; ordinary-member answers) ─────────
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
CREATE FUNCTION public.is_banned(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
CREATE FUNCTION public.account_is_live() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT true $$;
CREATE FUNCTION public.are_friends(_a uuid, _b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
CREATE FUNCTION public.feature_allowed_me(_feature text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT true $$;

-- production body
CREATE FUNCTION public.can_view_post(_viewer_id uuid, _post_user_id uuid, _privacy text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN _viewer_id = _post_user_id THEN true
      WHEN _privacy = 'public' THEN true
      WHEN _privacy = 'friends' AND _viewer_id IS NOT NULL THEN public.are_friends(_viewer_id, _post_user_id)
      ELSE false
    END;
$function$;

-- ── posts ───────────────────────────────────────────────────────────────────
CREATE TABLE public.posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  content         text,
  privacy         text NOT NULL DEFAULT 'public',
  categories      text[],
  image_urls      text[],
  image_url       text,
  content_hash    text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX posts_user_idempotency_key ON public.posts (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage posts" ON public.posts FOR ALL TO public
  USING (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Banned users cannot create posts" ON public.posts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned((SELECT auth.uid())));
CREATE POLICY "Deleted accounts cannot delete" ON public.posts AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.posts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.posts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.account_is_live()));
CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE TO public
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert own posts" ON public.posts FOR INSERT TO public
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE TO public
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can view posts based on privacy" ON public.posts FOR SELECT TO public
  USING (public.can_view_post((SELECT auth.uid()), user_id, privacy));

-- a no-op stand-in, so the 20261011_0003 PROBE's trigger check has its trigger
CREATE FUNCTION public.rate_limit_posts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_rate_limit_posts BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_posts();

-- ── media_objects / post_media ──────────────────────────────────────────────
CREATE TABLE public.media_objects (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL
);
ALTER TABLE public.media_objects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.post_media (
  post_id  uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  ord      integer NOT NULL CHECK (ord >= 0),
  media_id uuid NOT NULL REFERENCES public.media_objects(id) ON DELETE RESTRICT,
  PRIMARY KEY (post_id, ord)
);
ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
-- production policy text
CREATE POLICY post_media_delete_own ON public.post_media FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_media.post_id AND p.user_id = auth.uid()));
CREATE POLICY post_media_select ON public.post_media FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_media.post_id AND public.can_view_post(auth.uid(), p.user_id, p.privacy)));
CREATE POLICY post_media_write_own ON public.post_media FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_media.post_id AND p.user_id = auth.uid()));
CREATE POLICY media_objects_select ON public.media_objects FOR SELECT TO public
  USING ((owner_id = auth.uid()) OR (EXISTS (SELECT 1 FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
                                              WHERE pm.media_id = media_objects.id AND public.can_view_post(auth.uid(), p.user_id, p.privacy))));

-- ── videos / post_videos (VID-1, staging text) ──────────────────────────────
CREATE TABLE public.videos (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  state    text NOT NULL,
  purpose  text NOT NULL
);
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY videos_read ON public.videos FOR SELECT TO anon, authenticated
  USING (owner_id = (SELECT auth.uid()) OR state = 'ready');

CREATE TABLE public.post_videos (
  post_id    uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  video_id   uuid NOT NULL UNIQUE REFERENCES public.videos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.post_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deleted accounts cannot insert" ON public.post_videos AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.account_is_live()));
CREATE POLICY post_videos_delete_own ON public.post_videos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_videos.post_id AND p.user_id = (SELECT auth.uid())));
CREATE POLICY post_videos_insert_own ON public.post_videos FOR INSERT TO authenticated
  WITH CHECK ((EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_videos.post_id AND p.user_id = (SELECT auth.uid())))
              AND (SELECT public.feature_allowed_me('video_posts')));
CREATE POLICY post_videos_read ON public.post_videos FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_videos.post_id));

-- staging body
CREATE FUNCTION public.tg_post_videos_link_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _v record;
  _p record;
BEGIN
  SELECT owner_id, purpose, state INTO _v FROM public.videos WHERE id = NEW.video_id FOR UPDATE;
  SELECT user_id, categories INTO _p FROM public.posts WHERE id = NEW.post_id;
  IF _v.state IS DISTINCT FROM 'ready' OR _v.purpose IS DISTINCT FROM 'post' THEN
    RAISE EXCEPTION 'VID-LINK-001: post_videos needs a ready post video (video is %)', coalesce(_v.state, '<missing>')
      USING ERRCODE = 'check_violation';
  END IF;
  IF _p.user_id IS NULL OR _p.user_id <> _v.owner_id THEN
    RAISE EXCEPTION 'VID-LINK-002: the video must belong to the post''s author' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(coalesce(_p.categories, '{}')) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'VID-CAT-001: a video post needs between 1 and 5 categories' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER tg_post_videos_link_guard BEFORE INSERT OR UPDATE ON public.post_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_post_videos_link_guard();

-- ── exact table ACLs ────────────────────────────────────────────────────────
REVOKE ALL ON public.posts, public.media_objects, public.post_media, public.videos, public.post_videos
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, MAINTAIN ON public.posts TO anon, authenticated;            -- arwdm
GRANT ALL ON public.posts, public.media_objects, public.post_media, public.videos, public.post_videos TO service_role;
GRANT SELECT, INSERT, DELETE ON public.post_videos TO authenticated;                              -- ard
GRANT SELECT ON public.post_videos TO anon;                                                       -- r

-- ── assertion helpers (schema fx; SECURITY INVOKER, so they run as the caller) ─
CREATE SCHEMA fx;
GRANT USAGE ON SCHEMA fx TO anon, authenticated;
-- Runs _sql as the current role and ALWAYS rolls it back; returns 'ok' or
-- '<SQLSTATE>: <message>'.
CREATE FUNCTION fx.outcome(_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
    RAISE EXCEPTION 'fx: roll this back' USING ERRCODE = 'FX000';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'FX000' THEN
      RETURN 'ok';
    END IF;
    RETURN SQLSTATE || ': ' || SQLERRM;
  END;
END
$$;
CREATE FUNCTION fx.check(_label text, _got text, _want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'FIXTURE FAIL %: got [%] want [%]', _label, coalesce(_got, 'NULL'), coalesce(_want, 'NULL');
  END IF;
  RAISE NOTICE 'FIXTURE PASS %: %', _label, _got;
END
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fx TO anon, authenticated;
