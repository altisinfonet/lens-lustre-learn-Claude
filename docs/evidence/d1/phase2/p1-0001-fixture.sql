-- ── P1 · 20260920_0001 fixture · scratch PostgreSQL 17 + pg_cron only. ─────
-- The shape both lanes present to 0001, as measured on staging 2026-09-26
-- (read-only SELECTs, recorded in p1-0001-derivation-20260926.md):
--
--   * public.profiles: id uuid PK, last_active_at timestamptz DEFAULT now()
--     (nullable), last_platform text CHECK IN ('app','web'), privacy_settings.
--   * the AFTER UPDATE trigger that mirrors last_active_at into
--     profiles_public_data (sync_profiles_public_data_trg) — reduced here to
--     the one column it copies, because the side effect is what is counted.
--   * public.member_activity_minutes(user_id, minute_bucket, surface,
--     had_interaction), PK (user_id, minute_bucket).
--   * default privileges after 0043: global {postgres=X}, public
--     {postgres, authenticated, service_role} — Phase 1 sign-off row 9.
--   * auth.uid() as Supabase defines it: request.jwt.claim.sub, else the sub
--     inside request.jwt.claims.
--
-- An AFTER UPDATE counter (fx_updates) records every UPDATE that reaches a
-- profiles row, so "one row update, not two" is counted, not inferred.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id               uuid PRIMARY KEY,
  full_name        text,
  last_active_at   timestamptz DEFAULT now(),
  last_platform    text CONSTRAINT profiles_last_platform_check CHECK (last_platform = ANY (ARRAY['app','web'])),
  privacy_settings jsonb
);
CREATE TABLE public.profiles_public_data (id uuid PRIMARY KEY, last_active_at timestamptz);
CREATE TABLE public.member_activity_minutes (
  user_id uuid NOT NULL, minute_bucket timestamptz NOT NULL,
  surface text NOT NULL DEFAULT 'public', had_interaction boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, minute_bucket)
);

CREATE FUNCTION public.fx_sync_public() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.profiles_public_data (id, last_active_at)
  VALUES (NEW.id, CASE WHEN coalesce(NEW.privacy_settings->>'active_status','on') = 'off' THEN NULL ELSE NEW.last_active_at END)
  ON CONFLICT (id) DO UPDATE SET last_active_at = EXCLUDED.last_active_at;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_profiles_public_data_trg AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fx_sync_public();

CREATE TABLE public.fx_updates (n bigserial, id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.fx_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.fx_updates (id) VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER fx_count_updates AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fx_count();

-- Members. A: the caller. B: the neighbour whose row must not move.
-- X..V: the backfill cases (see p1-0001-run-tests.sh step 6).
INSERT INTO public.profiles (id, full_name, last_active_at, last_platform) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A', now() - interval '2 hours', 'app'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'B', now() - interval '2 hours', 'app');
TRUNCATE public.fx_updates;

-- A stable digest of one member's row (and its public mirror).
CREATE FUNCTION public.fx_row(_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT row(p.*)::text FROM public.profiles p WHERE p.id = _id), '(none)') ||
             coalesce((SELECT row(d.*)::text FROM public.profiles_public_data d WHERE d.id = _id), '(none)'))
$$;
-- A stable digest of the default-privilege catalogue (sign-off row 9).
CREATE FUNCTION public.fx_defacl() RETURNS text LANGUAGE sql AS $$
  SELECT md5(string_agg(x, E'\n' ORDER BY x))
    FROM (SELECT d.defaclrole::regrole::text||' '||coalesce(n.nspname,'(GLOBAL)')||' '||d.defaclobjtype::text||' '||d.defaclacl::text AS x
            FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace) t
$$;
\echo 'FIXTURE BUILT (P1 0001)'
