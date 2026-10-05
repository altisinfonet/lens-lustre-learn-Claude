-- UB-0003 fixture — SCRATCH ONLY (database p5cron = cron.database_name; real pg_cron 1.6).
-- public.user_blocks + its AFTER INSERT trigger (20261003_0001) and the ledger +
-- notify_admin_user_blocked() of 20261003_0002, the function copied VERBATIM
-- from supabase/migrations/20261003_0002_user_blocks_hardening.sql. profiles /
-- admin_notifications / auth.users are minimal stand-ins with the columns the
-- function reads and writes.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.admin_notifications (id bigserial PRIMARY KEY, type text, title text, message text, reference_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE public.user_block_notices (
  blocker_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id));
CREATE INDEX idx_user_block_notices_blocked_id ON public.user_block_notices (blocked_id);
ALTER TABLE public.user_block_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_block_notices FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_admin_user_blocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _blocker text;
  _blocked text;
  _claimed int;
BEGIN
  -- SEC-UB-1: claim this pair's notice slot. A row is written (or moved
  -- forward) only when the pair has no notice in the last 24 hours; otherwise
  -- the statement affects 0 rows and no notice is written.
  INSERT INTO public.user_block_notices AS n (blocker_id, blocked_id, notified_at)
  VALUES (NEW.blocker_id, NEW.blocked_id, now())
  ON CONFLICT (blocker_id, blocked_id) DO UPDATE
     SET notified_at = EXCLUDED.notified_at
   WHERE n.notified_at <= EXCLUDED.notified_at - interval '24 hours';
  GET DIAGNOSTICS _claimed = ROW_COUNT;
  IF _claimed = 0 THEN
    RETURN NEW;
  END IF;

  -- Unchanged from 20261003_0001 below this line.
  SELECT full_name INTO _blocker FROM public.profiles WHERE id = NEW.blocker_id;
  SELECT full_name INTO _blocked FROM public.profiles WHERE id = NEW.blocked_id;

  INSERT INTO public.admin_notifications (type, title, message, reference_id)
  VALUES (
    'user_blocked',
    'Member blocked by another member',
    COALESCE(_blocker, 'A member') || ' blocked ' || COALESCE(_blocked, 'a member')
      || ' (user ' || NEW.blocked_id::text || '). Review that member''s recent posts and comments for objectionable content.',
    NEW.blocked_id
  );
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER user_blocks_notify_admin AFTER INSERT ON public.user_blocks FOR EACH ROW EXECUTE FUNCTION public.notify_admin_user_blocked();
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid FROM generate_series(1, 2000) g;
