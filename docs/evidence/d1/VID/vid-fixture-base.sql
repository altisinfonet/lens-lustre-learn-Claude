-- VID fixture (base) — SCRATCH ONLY (database p5cron = cron.database_name; real pg_cron 1.6).
-- The objects the VID units read, with staging's columns and functions as read
-- 2026-10-05: auth.users (id, email) + auth.uid() from the request JWT setting,
-- profiles (full_name, avatar_url, custom_url), user_roles + has_role(uuid,app_role)
-- and has_role(uuid,text) (verbatim bodies), app_role enum (staging's labels),
-- account_is_live() (stub: true), categories (slug, is_active), posts (the
-- columns the units touch + the posts_categories_max_5 CHECK + its
-- enforce_post_categories trigger, appended per lane shape), ad_creatives +
-- staging's two policies. vault is a stub with the real signatures.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
-- pgcrypto in schema extensions, as on both lanes (read on staging 2026-10-10: pgcrypto_schema = extensions).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
-- Start from PostgreSQL's own default (PUBLIC may EXECUTE new functions) so the fixture builds the
-- same way on every run; staging's default privileges are set at the END of this file.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('user','judge','content_editor','admin','registered_photographer','student');
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, full_name text, avatar_url text, custom_url text);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role text NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role::text) $$;
CREATE FUNCTION public.account_is_live() RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
CREATE TABLE public.categories (slug text PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY categories_read ON public.categories FOR SELECT USING (true);
GRANT SELECT ON public.categories TO anon, authenticated;
INSERT INTO public.categories VALUES ('street', true), ('portrait', true), ('landscape', true), ('night', true), ('wildlife', true), ('macro', true), ('retired', false);
CREATE TABLE public.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content text NOT NULL DEFAULT '',
  privacy text NOT NULL DEFAULT 'public' CHECK (privacy IN ('private','friends','public')), categories text[] NOT NULL DEFAULT '{}'::text[],
  post_kind text NOT NULL DEFAULT 'member' CHECK (post_kind IN ('member','system')), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posts_categories_max_5 CHECK (cardinality(categories) <= 5));
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view posts based on privacy" ON public.posts FOR SELECT USING (privacy = 'public' OR user_id = auth.uid());
CREATE POLICY "Users can insert own posts" ON public.posts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Admins can manage posts" ON public.posts FOR ALL USING (public.has_role(auth.uid(), 'admin'::public.app_role));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT ON public.posts TO anon;
CREATE TABLE public.ad_creatives (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), zone text NOT NULL DEFAULT 'feed', image_url text, click_url text,
  headline text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY ad_creatives_admin_all ON public.ad_creatives FOR ALL USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY ad_creatives_public_read_active ON public.ad_creatives FOR SELECT USING (is_active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_creatives TO authenticated;
GRANT SELECT ON public.ad_creatives TO anon;
-- people: one admin, four members (Neil Basu among them, as in R-103's example)
INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 'neil@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'riya@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b3', 'arun@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b4', 'mira@example.invalid');
INSERT INTO public.profiles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Site Admin', NULL, 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Neil Basu', 'https://x.invalid/n.jpg', 'neilbasu'),
  ('00000000-0000-0000-0000-0000000000b2', 'Riya Sen', NULL, 'riya'),
  ('00000000-0000-0000-0000-0000000000b3', 'Arun Das', NULL, 'arun'),
  ('00000000-0000-0000-0000-0000000000b4', 'Mira Roy', NULL, 'mira');
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
-- ── vault (stub) ──
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text NOT NULL DEFAULT '',
  secret text NOT NULL, key_id uuid, nonce bytea, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets (name) WHERE name IS NOT NULL;
CREATE FUNCTION vault._decrypt(text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN RETURN $1; END $f$;
CREATE VIEW vault.decrypted_secrets AS SELECT s.*, vault._decrypt(s.secret) AS decrypted_secret FROM vault.secrets s;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL::text, new_description text DEFAULT ''::text, new_key_id uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE sql AS $f$ INSERT INTO vault.secrets (secret, name, description, key_id) VALUES (new_secret, new_name, new_description, new_key_id) RETURNING id $f$;

-- ── staging's default privileges for objects postgres creates (read 2026-10-05, pg_default_acl):
--    tables anon/authenticated/service_role ALL · sequences rwU · functions: PUBLIC none (global),
--    authenticated + service_role EXECUTE (public schema). Set LAST, so the migrations under test
--    meet exactly what a new object gets on the lanes — every REVOKE they make has to be real.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
