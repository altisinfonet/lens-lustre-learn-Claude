-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261110_0100 photo camera details · a LANE-SHAPED schema slice.
-- THROWAWAY DATABASE ONLY (see 00_cluster_roles.sql). Run with p32.lane set.
--
-- Copied exactly, because the unit depends on it:
--   * auth.uid() — Supabase's body;
--   * Supabase's DEFAULT PRIVILEGES in public: every new table AND function is
--     granted to anon / authenticated / service_role (F-66) — the worst case the
--     migration's explicit REVOKEs must beat;
--   * can_view_post() — the production body; posts' columns it reads;
--   * feature_access / _members / _audit, the append-only audit trigger and
--     feature_allowed() — the 20261005_0004 bodies (VID-7), ACLs revoked as there.
-- Lane shapes (the only difference this unit can see):
--   production — feature_access_feature_check = the 20261103_0601 list, one row each;
--   staging    — the same list PLUS a key another runner added concurrently
--                ('zz_concurrent_unit', row off): the migration must keep it
--                and the rollback must not drop it.
-- Reduced: profiles to its id; are_friends() to an accepted-friendship lookup.
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

CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.friendships (
  requester_id uuid NOT NULL, addressee_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending'
);
CREATE FUNCTION public.are_friends(_a uuid, _b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.friendships f WHERE f.status = 'accepted'
                  AND ((f.requester_id = _a AND f.addressee_id = _b) OR (f.requester_id = _b AND f.addressee_id = _a)))
$$;

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

CREATE TABLE public.posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  content    text,
  privacy    text NOT NULL DEFAULT 'public',
  image_urls text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view posts based on privacy" ON public.posts FOR SELECT TO public
  USING (public.can_view_post((SELECT auth.uid()), user_id, privacy));

-- ── feature_access (20261005_0004, verbatim where it matters) ───────────────
CREATE TABLE public.feature_access (
  feature     text PRIMARY KEY,
  mode        text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'selected', 'everyone')),
  note        text CHECK (note IS NULL OR char_length(note) <= 500),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.feature_access_members (
  feature   text NOT NULL REFERENCES public.feature_access(feature) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by  uuid,
  added_at  timestamptz NOT NULL DEFAULT now(),
  note      text CHECK (note IS NULL OR char_length(note) <= 500),
  PRIMARY KEY (feature, user_id)
);
CREATE TABLE public.feature_access_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      uuid,
  feature    text NOT NULL,
  action     text NOT NULL CHECK (action IN ('mode', 'add', 'remove')),
  old_value  text,
  new_value  text,
  user_id    uuid,
  note       text
);
ALTER TABLE public.feature_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_access_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feature_access, public.feature_access_members, public.feature_access_audit FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.tg_feature_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  RAISE EXCEPTION 'feature_access_audit is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$fn$;
CREATE TRIGGER tg_feature_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.feature_access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_feature_audit_append_only();

CREATE FUNCTION public.feature_allowed(_feature text, _uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT CASE
           WHEN _uid IS NULL THEN false
           ELSE coalesce((SELECT CASE fa.mode
                                   WHEN 'everyone' THEN true
                                   WHEN 'selected' THEN EXISTS (SELECT 1 FROM public.feature_access_members m
                                                                 WHERE m.feature = fa.feature AND m.user_id = _uid)
                                   ELSE false END
                            FROM public.feature_access fa WHERE fa.feature = _feature), false)
         END;
$fn$;
REVOKE ALL ON FUNCTION public.feature_allowed(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── the lane's switch list ──────────────────────────────────────────────────
DO $lane$
BEGIN
  IF current_setting('p32.lane', true) = 'staging' THEN
    ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
      CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed',
                         'media_ladder_feed', 'media_private_photos', 'photo_upload_resume', 'zz_concurrent_unit'));
    INSERT INTO public.feature_access (feature, mode) VALUES ('zz_concurrent_unit', 'off');
  ELSE
    ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
      CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed',
                         'media_ladder_feed', 'media_private_photos', 'photo_upload_resume'));
  END IF;
  INSERT INTO public.feature_access (feature, mode)
  VALUES ('video_posts', 'everyone'), ('video_ads', 'off'), ('copyright_music_check', 'off'), ('personal_feed', 'off'),
         ('media_ladder_feed', 'off'), ('media_private_photos', 'off'), ('photo_upload_resume', 'off');
END
$lane$;

-- one live public post, so the PROBE has something to test on (as on both lanes)
INSERT INTO public.profiles (id) VALUES ('00000000-0000-4000-8000-0000000000a1');
INSERT INTO public.posts (user_id, privacy, content) VALUES ('00000000-0000-4000-8000-0000000000a1', 'public', 'lane post');
