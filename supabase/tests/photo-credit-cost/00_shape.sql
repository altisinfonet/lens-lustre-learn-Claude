-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261110_0112 credit sweep cost · what the REAL 0111 needs.
-- THROWAWAY DATABASE ONLY: scripts/db-photo-credit-cost-fixture.mjs refuses any
-- host that is not local. Staging names 1 v3 photo, so it cannot show a cost.
-- Copied: auth.uid(), media_derivative_worker_ok(). Reduced: everything else to
-- the columns 0111 reads, plus the indexes a look-up by id would use.
-- ═══════════════════════════════════════════════════════════════════════════
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END
$roles$;

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

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, custom_url text);
-- role is text on production (13 Oct 2026 snapshot); has_role casts, as there.
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role text NOT NULL, PRIMARY KEY (user_id, role));

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = _role::text)
$fn$;
CREATE FUNCTION public.video_is_converter()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $fn$ SELECT false $fn$;
CREATE FUNCTION public.media_derivative_worker_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.video_is_converter());
$fn$;

CREATE TABLE public.posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  content    text,
  image_urls text[] NOT NULL DEFAULT '{}'::text[]
);
CREATE INDEX idx_posts_user_id ON public.posts (user_id);
CREATE TABLE public.competition_entries (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title   text,
  photos  text[] NOT NULL DEFAULT '{}'::text[]
);
CREATE INDEX idx_comp_entries_user ON public.competition_entries (user_id);

CREATE TABLE public.photo_l4_rectify (
  post_id uuid NOT NULL, ord integer NOT NULL, credit_version integer NOT NULL DEFAULT 3, PRIMARY KEY (post_id, ord)
);
CREATE TABLE public.photo_old_credit (
  post_id uuid NOT NULL, ord integer NOT NULL, src_url text NOT NULL, credited_url text NOT NULL,
  credit_version integer NOT NULL, recorded_by uuid, recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, ord)
);
CREATE FUNCTION public.photo_set_backfill_cdn()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $fn$ SELECT 'cdn.fixture.test'::text $fn$;
CREATE FUNCTION public.photo_old_credit_class(_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $fn$ SELECT NULL::text $fn$;
CREATE FUNCTION public.photo_old_credit_key(_post_id uuid, _user_id uuid, _ord integer, _url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $fn$ SELECT NULL::text $fn$;
