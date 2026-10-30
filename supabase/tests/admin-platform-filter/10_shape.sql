-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · admin users platform filter (20261103_0101) · schema slice.
-- THROWAWAY DATABASE ONLY (see 00_cluster_roles.sql).
--
-- Copied exactly where the unit depends on it (from the 2026-09-11 schema
-- bootstrap, UNAPPLIED_20260911101721, which both lanes were built from):
--   * auth.uid() — Supabase's body;
--   * public.user_roles.role is `text` (DEFAULT 'user'::app_role);
--   * public.profiles columns admin_search_users_v2 returns, and
--     last_platform with profiles_last_platform_check (app/web);
--   * Supabase's default privileges: new functions in public are EXECUTE-able
--     by anon/authenticated/service_role unless revoked — so 0101's REVOKE is
--     what the fixture checks, not an empty ACL.
-- has_role(uuid, text), has_role(uuid, app_role) and admin_search_users_v2 are
-- NOT defined here: the runner installs them verbatim from the bootstrap.
-- Reduced: every table to the columns read.
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id         uuid PRIMARY KEY,
  email      character varying(255),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'judge', 'content_editor', 'registered_photographer', 'student');

CREATE TABLE public.user_roles (
  id         uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id    uuid NOT NULL,
  role       text DEFAULT 'user'::public.app_role NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);
CREATE TABLE public.user_badges (
  id          uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id     uuid NOT NULL,
  badge_type  text NOT NULL,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE public.profiles (
  id                uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name         text,
  avatar_url        text,
  bio               text,
  is_suspended      boolean DEFAULT false,
  suspended_until   timestamptz,
  suspension_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_active_at    timestamptz DEFAULT now(),
  last_platform     text,
  CONSTRAINT profiles_last_platform_check CHECK ((last_platform = ANY (ARRAY['app'::text, 'web'::text])))
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all ON public.profiles FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.profiles TO authenticated;
