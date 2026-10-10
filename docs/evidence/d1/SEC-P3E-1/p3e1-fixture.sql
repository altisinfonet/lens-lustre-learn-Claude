-- SEC-P3E-1 fixture — SCRATCH CLUSTER ONLY (database p3e1).
-- VERBATIM from staging fpszggreishhuvdpkmdr (read-only, 2026-10-10 08:1x UTC):
--   auth.uid(); public.can_view_post, are_friends, account_is_live,
--   update_post_shares_count (pg_get_functiondef); post_shares columns, keys,
--   trigger and ALL its policies; posts' two SELECT policies; grants on
--   post_shares (anon + authenticated: all).
-- STUBS, stated: auth.users (id, created_at); posts / friendships reduced to the
-- columns these policies read; has_role (user_roles table) for posts' admin policy.
-- psql variable: shape = staging | production (production publishes post_shares).
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE TABLE auth.users (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $f$;

CREATE TABLE public.friendships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid, addressee_id uuid, status text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  privacy text NOT NULL DEFAULT 'public' CHECK ((privacy = ANY (ARRAY['private'::text, 'friends'::text, 'public'::text]))),
  shares_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.posts TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.account_is_live()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from auth.users u where u.id = auth.uid());
$function$;
CREATE OR REPLACE FUNCTION public.are_friends(_user_a uuid, _user_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND (
        (requester_id = _user_a AND addressee_id = _user_b)
        OR (requester_id = _user_b AND addressee_id = _user_a)
      )
  );
$function$;
CREATE OR REPLACE FUNCTION public.can_view_post(_viewer_id uuid, _post_user_id uuid, _privacy text)
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
CREATE OR REPLACE FUNCTION public.update_post_shares_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET shares_count = shares_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET shares_count = GREATEST(shares_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage posts" ON public.posts AS PERMISSIVE FOR ALL TO public USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Users can view posts based on privacy" ON public.posts AS PERMISSIVE FOR SELECT TO public USING (can_view_post(( SELECT auth.uid() AS uid), user_id, privacy));

CREATE TABLE public.post_shares (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE, user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (post_id, user_id));
CREATE INDEX idx_post_shares_post_id ON public.post_shares (post_id);
CREATE INDEX idx_post_shares_user_id ON public.post_shares (user_id);
CREATE TRIGGER trg_update_post_shares_count AFTER INSERT OR DELETE ON public.post_shares FOR EACH ROW EXECUTE FUNCTION update_post_shares_count();
GRANT ALL ON public.post_shares TO anon, authenticated;
ALTER TABLE public.post_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view shares" ON public.post_shares AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Deleted accounts cannot delete" ON public.post_shares AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT account_is_live() AS account_is_live));
CREATE POLICY "Deleted accounts cannot insert" ON public.post_shares AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT account_is_live() AS account_is_live));
CREATE POLICY "Deleted accounts cannot update" ON public.post_shares AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT account_is_live() AS account_is_live));
CREATE POLICY "Users can share posts" ON public.post_shares AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can unshare" ON public.post_shares AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

-- live-looking data: six members, one post of each privacy by three authors
INSERT INTO auth.users (id, created_at) SELECT ('00000000-0000-0000-0000-00000000000' || i)::uuid, now() - (10 - i) * interval '1 day' FROM generate_series(1, 6) i;
INSERT INTO public.posts (user_id, privacy, created_at) VALUES
  ('00000000-0000-0000-0000-000000000004', 'public',  now()),
  ('00000000-0000-0000-0000-000000000005', 'friends', now()),
  ('00000000-0000-0000-0000-000000000006', 'private', now());

SELECT (:'shape' = 'production') AS is_production \gset
\if :is_production
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE public.post_shares;
\endif
