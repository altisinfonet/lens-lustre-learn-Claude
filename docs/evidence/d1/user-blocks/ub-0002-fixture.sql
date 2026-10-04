-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE for 20261003_0002_user_blocks_hardening — SCRATCH CLUSTER ONLY.
--
-- The smallest copy of what 20261003_0001 and 0002 depend on, each shape read
-- from staging fpszggreishhuvdpkmdr (Supabase MCP, read-only, 2026-10-04
-- 05:06–05:08 UTC):
--   * auth.uid(): request.jwt.claim.sub, else request.jwt.claims->>'sub' (verbatim body)
--   * public.account_is_live(): STABLE SECURITY DEFINER, search_path '' (verbatim body)
--   * public.has_role(uuid, app_role): STABLE SECURITY DEFINER, search_path public (verbatim body)
--   * public.user_roles (id, user_id, role text, created_at)
--   * public.admin_notifications (id, type default 'support_ticket', title, message,
--     reference_id, is_read, created_at); RLS on; its 2 permissive + 3 restrictive policies
--   * postgres is a member of anon and authenticated (pg_has_role, both true)
-- profiles is reduced to (id, full_name): the only columns 0001/0002 read.
-- After this file the harness applies 20261003_0001 VERBATIM (the file on main
-- 566fe1b, applied on production by run #105), so 0002 is tested against the
-- exact state it will meet.
-- ═══════════════════════════════════════════════════════════════════════════
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$f$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('user','judge','content_editor','admin','registered_photographer','student');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
                                role text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role::text
  )
$f$;
CREATE FUNCTION public.account_is_live() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
  select exists (select 1 from auth.users u where u.id = auth.uid());
$f$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role), public.account_is_live() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);

CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text DEFAULT 'support_ticket'::text,
  title text, message text, reference_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now());
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can delete admin notifications" ON public.admin_notifications FOR DELETE TO authenticated
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Admins can manage admin notifications" ON public.admin_notifications FOR ALL TO public
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Deleted accounts cannot delete" ON public.admin_notifications AS RESTRICTIVE FOR DELETE TO authenticated
  USING (( SELECT account_is_live() AS account_is_live));
CREATE POLICY "Deleted accounts cannot insert" ON public.admin_notifications AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT account_is_live() AS account_is_live));
CREATE POLICY "Deleted accounts cannot update" ON public.admin_notifications AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (( SELECT account_is_live() AS account_is_live));
GRANT ALL ON public.admin_notifications TO anon, authenticated, service_role;

-- Members: A, B, C live; D is a deleted account (has a profile, no auth.users row);
-- M is an admin; F and G are live members the harness never touches, so the
-- PROBE (which picks two members with no block and no notice) always finds a pair.
INSERT INTO auth.users VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a'), ('bbbbbbbb-0000-4000-8000-00000000000b'),
  ('cccccccc-0000-4000-8000-00000000000c'), ('eeeeeeee-0000-4000-8000-0000000000ee'),
  ('ffffffff-0000-4000-8000-0000000000f1'), ('ffffffff-0000-4000-8000-0000000000f2');
INSERT INTO public.profiles VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a','Member A'), ('bbbbbbbb-0000-4000-8000-00000000000b','Member B'),
  ('cccccccc-0000-4000-8000-00000000000c','Member C'), ('dddddddd-0000-4000-8000-00000000000d','Deleted D'),
  ('eeeeeeee-0000-4000-8000-0000000000ee','Admin M'),
  ('ffffffff-0000-4000-8000-0000000000f1','Member F'), ('ffffffff-0000-4000-8000-0000000000f2','Member G');
INSERT INTO public.user_roles (user_id, role) VALUES ('eeeeeeee-0000-4000-8000-0000000000ee','admin');
