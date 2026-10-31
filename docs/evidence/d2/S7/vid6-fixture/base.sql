DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=$q$anon$q$) THEN CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; END IF; END $r$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), created_at timestamptz DEFAULT now());
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2) $$;
CREATE TABLE public.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.ad_creatives (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(_n text, _s text, _c text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (_n,_s,_c) ON CONFLICT (jobname) DO UPDATE SET schedule=EXCLUDED.schedule, command=EXCLUDED.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(_n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname=_n RETURNING true $$;
CREATE SCHEMA net;
