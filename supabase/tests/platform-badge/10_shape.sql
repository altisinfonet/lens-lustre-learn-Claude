-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · Unit A (platform badge) · the schema slice both lanes share.
-- THROWAWAY DATABASE ONLY (see 00_cluster_roles.sql).
--
-- Copied exactly where the unit depends on it:
--   * auth.uid() — Supabase's body (reads request.jwt.claim(s).sub);
--   * public.profiles.last_active_at timestamptz / last_platform text;
--   * public.member_activity_minutes (user_id, minute_bucket, surface,
--     had_interaction) and record_activity_minute() — 20260811180000's body;
--   * record_session_end() and backfill_last_seen() are NOT defined here: the
--     runner installs them verbatim from 20260920_0001;
--   * the S8 F-P1-6 BEFORE UPDATE trigger is installed verbatim from
--     20261029_0002 by the runner (both lanes carry it).
-- Reduced: profiles / auth.users to the columns read; cron to the two tables
-- the PROBEs read (pg_cron is not installable here); client_errors and
-- push_tokens to the columns read.
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
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id             uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name      text,
  last_active_at timestamptz,
  last_platform  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY read_all ON public.profiles FOR SELECT TO authenticated USING (true);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

CREATE TABLE public.member_activity_minutes (
  user_id         uuid        NOT NULL,
  minute_bucket   timestamptz NOT NULL,
  surface         text        NOT NULL CHECK (surface IN ('public', 'internal')),
  had_interaction boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, minute_bucket)
);
ALTER TABLE public.member_activity_minutes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.client_errors (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  kind       text,
  platform   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  token      text NOT NULL UNIQUE,
  platform   text NOT NULL CHECK (platform IN ('ios','android','web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid    bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command  text NOT NULL,
  jobname  text,
  active   boolean NOT NULL DEFAULT true
);
CREATE TABLE cron.job_run_details (
  runid      bigserial PRIMARY KEY,
  jobid      bigint,
  status     text,
  start_time timestamptz
);
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command) RETURNING jobid
$$;

-- record_activity_minute — 20260811180000's body.
CREATE OR REPLACE FUNCTION public.record_activity_minute(
  _segment    text,
  _interacted boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _user    uuid := auth.uid();
  _bucket  timestamptz;
  _surface text;
BEGIN
  IF _user IS NULL THEN
    RETURN;
  END IF;
  _bucket := date_trunc('minute', now());
  _surface := CASE
    WHEN lower(coalesce(_segment, '')) IN ('admin', 'judge') THEN 'internal'
    ELSE 'public'
  END;
  INSERT INTO public.member_activity_minutes (user_id, minute_bucket, surface, had_interaction)
  VALUES (_user, _bucket, _surface, coalesce(_interacted, false))
  ON CONFLICT (user_id, minute_bucket) DO UPDATE
  SET
    surface = CASE
      WHEN public.member_activity_minutes.surface = 'internal' THEN 'internal'
      WHEN EXCLUDED.surface = 'internal' THEN 'internal'
      ELSE 'public'
    END,
    had_interaction = public.member_activity_minutes.had_interaction OR EXCLUDED.had_interaction;
END
$fn$;
REVOKE ALL ON FUNCTION public.record_activity_minute(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_activity_minute(text, boolean) TO authenticated;
