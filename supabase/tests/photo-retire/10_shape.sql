-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261110_0103 photo retire (U6) · a LANE-SHAPED schema slice.
-- THROWAWAY DATABASE ONLY (scripts/db-photo-retire-fixture.mjs refuses a
-- non-local host). Run with p32.lane set. Roles: ../photo-camera/00_cluster_roles.sql.
-- Copied exactly: auth.uid(), Supabase DEFAULT PRIVILEGES, has_role(),
-- media_derivative_worker_ok(), feature_access(+audit, append-only trigger),
-- the live trigger sync_competition_result_state_from_round_publish (it is how
-- "results final" is defined on both lanes). Reduced: pg_cron to cron.job +
-- schedule/unschedule; competitions / entries / posts / featured_photos to the
-- columns read. Lane shapes: each lane's CDN host and switch list.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(_name text) RETURNS boolean LANGUAGE sql AS
  $$ DELETE FROM cron.job WHERE jobname = _name RETURNING true $$;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role::text)
$function$;
CREATE FUNCTION public.video_is_converter() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.media_derivative_worker_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.video_is_converter());
$fn$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.competitions (id uuid PRIMARY KEY, title text, status text, phase text, current_round text, judging_completed boolean DEFAULT false, updated_at timestamptz);
CREATE TABLE public.competition_round_publish (competition_id uuid NOT NULL, round_number int NOT NULL, published_at timestamptz, PRIMARY KEY (competition_id, round_number));
CREATE TABLE public.competition_entries (id uuid PRIMARY KEY, competition_id uuid NOT NULL, user_id uuid NOT NULL, title text, photos text[], photo_thumbnails text[], photo_meta jsonb);
CREATE TABLE public.posts (id uuid PRIMARY KEY, user_id uuid, content text, image_urls text[]);
CREATE TABLE public.featured_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_url text, thumbnail_url text);

-- production body
CREATE FUNCTION public.sync_competition_result_state_from_round_publish() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.round_number = 4 THEN
    IF NEW.published_at IS NOT NULL THEN
      UPDATE public.competitions SET current_round = '4', phase = 'result', status = 'result', judging_completed = true, updated_at = now()
       WHERE id = NEW.competition_id AND (current_round IS DISTINCT FROM '4' OR phase IS DISTINCT FROM 'result' OR status IS DISTINCT FROM 'result' OR judging_completed IS DISTINCT FROM true);
    ELSE
      UPDATE public.competitions c SET phase = 'judging', status = 'judging', judging_completed = false, updated_at = now()
       WHERE c.id = NEW.competition_id
         AND NOT EXISTS (SELECT 1 FROM public.competition_round_publish crp WHERE crp.competition_id = NEW.competition_id AND crp.round_number = 4 AND crp.published_at IS NOT NULL)
         AND c.phase = 'result' AND c.status = 'result' AND c.judging_completed = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_sync_competition_result_state_from_round_publish AFTER INSERT OR UPDATE OF published_at ON public.competition_round_publish
  FOR EACH ROW EXECUTE FUNCTION public.sync_competition_result_state_from_round_publish();

CREATE TABLE public.feature_access (feature text PRIMARY KEY, mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'selected', 'everyone')), note text, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.feature_access_members (feature text NOT NULL REFERENCES public.feature_access(feature) ON DELETE CASCADE, user_id uuid NOT NULL, PRIMARY KEY (feature, user_id));
CREATE TABLE public.feature_access_audit (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor uuid, feature text NOT NULL,
  action text NOT NULL CHECK (action IN ('mode', 'add', 'remove')), old_value text, new_value text, user_id uuid, note text);
CREATE FUNCTION public.tg_feature_audit_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN RAISE EXCEPTION 'feature_access_audit is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege'; END; $fn$;
CREATE TRIGGER tg_feature_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.feature_access_audit FOR EACH STATEMENT EXECUTE FUNCTION public.tg_feature_audit_append_only();
ALTER TABLE public.feature_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feature_access, public.feature_access_members, public.feature_access_audit FROM PUBLIC, anon, authenticated;

DO $lane$
DECLARE
  _h text := CASE current_setting('p32.lane', true) WHEN 'staging' THEN 'cdn-staging.50mmretina.com' ELSE 'cdn.50mmretina.com' END;
  _u text := '00000000-0000-4000-8000-0000000000a1';
  _c text;
BEGIN
  IF current_setting('p32.lane', true) = 'staging' THEN
    ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
      CHECK (feature IN ('video_posts', 'media_ladder_feed', 'photo_set_v2', 'zz_concurrent_unit'));
    INSERT INTO public.feature_access (feature, mode) VALUES ('zz_concurrent_unit', 'off');
  ELSE
    ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
      CHECK (feature IN ('video_posts', 'media_ladder_feed', 'photo_set_v2'));
  END IF;
  INSERT INTO public.feature_access (feature, mode) VALUES ('video_posts', 'everyone'), ('media_ladder_feed', 'off'), ('photo_set_v2', 'off');

  INSERT INTO public.profiles (id) VALUES (_u::uuid), ('00000000-0000-4000-8000-0000000000ad');
  INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-8000-0000000000ad', 'admin');
  _c := 'https://' || _h || '/competition-photos/' || _u || '/competitions/';
  INSERT INTO public.competitions (id, title, status, phase) VALUES
    ('00000000-0000-4000-8000-0000000000c1', 'final 40 days ago', 'judging', 'judging'),
    ('00000000-0000-4000-8000-0000000000c2', 'final 10 days ago', 'judging', 'judging'),
    ('00000000-0000-4000-8000-0000000000c3', 'round 4 published then withdrawn', 'judging', 'judging');
  INSERT INTO public.competition_round_publish (competition_id, round_number, published_at) VALUES
    ('00000000-0000-4000-8000-0000000000c1', 1, now() - interval '90 days'),
    ('00000000-0000-4000-8000-0000000000c1', 4, now() - interval '40 days'),
    ('00000000-0000-4000-8000-0000000000c2', 4, now() - interval '10 days'),
    ('00000000-0000-4000-8000-0000000000c3', 3, now() - interval '60 days'),
    ('00000000-0000-4000-8000-0000000000c3', 4, NULL);
  INSERT INTO public.competition_entries (id, competition_id, user_id, photos, photo_thumbnails) VALUES
    -- E1 · final + 40 days, two v2 photos → both due
    ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c1', _u::uuid,
     ARRAY[_c || 'a1-w6000h4000-l4f.webp', _c || 'a2-w4000h6000-l4f.webp?v=1'],
     ARRAY[_c || 'a1-w6000h4000-l4f-thumb.webp', _c || 'a2-w4000h6000-l4f-thumb.webp']),
    -- E2 · final + 10 days → not yet
    ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000c2', _u::uuid, ARRAY[_c || 'b1-w5000h3000-l4f.webp'], NULL),
    -- E3 · round 4 withdrawn → never
    ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000c3', _u::uuid, ARRAY[_c || 'c1-w5000h3000-l4f.webp'], NULL),
    -- E4 · final + 40 days but an OLD (pre-v2) photo, no 2048 copy → never
    ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000c1', _u::uuid, ARRAY[_c || 'old-photo.webp'], NULL),
    -- E5 · due, but a featured photo still names it → kept
    ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000c1', _u::uuid, ARRAY[_c || 'f1-w3000h2000-l4f.webp'], NULL),
    -- E6 · another lane's host → never
    ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000c1', _u::uuid,
     ARRAY['https://' || CASE WHEN _h = 'cdn.50mmretina.com' THEN 'cdn-staging.50mmretina.com' ELSE 'cdn.50mmretina.com' END
           || '/competition-photos/' || _u || '/competitions/x-w3000h2000-l4f.webp'], NULL);
  INSERT INTO public.featured_photos (image_url) VALUES (_c || 'f1-w3000h2000-l4f.webp');
  INSERT INTO public.posts (id, user_id, content, image_urls) VALUES
    ('00000000-0000-4000-8000-0000000000f1', _u::uuid, 'p', ARRAY['https://' || _h || '/post-images/' || _u || '/posts/p1-w2000h1500-l3.webp']);
END
$lane$;
