-- ═══════════════════════════════════════════════════════════════════════════
-- 20261003_0001 — user_blocks: members can block abusive members
-- App Store review 2026-09-28, guideline 1.2 (user-generated content):
--   "a mechanism for users to block abusive users (blocking should also notify
--    the developer of the inappropriate content and should remove it from the
--    user's feed instantly)".
--
-- The instant removal from the feed is client-side (the blocker's own client
-- hides the blocked member's posts and comments the moment the row exists).
-- This migration is the durable half: the row itself, and the notice to the
-- moderation team.
--
-- OBJECTS
--   new  public.user_blocks (blocker_id, blocked_id, created_at)
--   new  public.notify_admin_user_blocked()  trigger function, AFTER INSERT
--   new  trigger user_blocks_notify_admin on public.user_blocks
--   write public.admin_notifications — one row per block, through the trigger
--
-- ACCESS. RLS on. A member can read, create and delete only the rows where they
-- are the blocker; an admin can read all of them. anon has nothing. Nothing
-- here is SECURITY DEFINER except the trigger function, whose EXECUTE is
-- revoked from every API role (it is only ever fired by the trigger).
--
-- ROLLBACK: supabase/rollback/20261003_0001_user_blocks_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_user_blocks_closed.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_id_idx ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_blocks_select_admin ON public.user_blocks;
CREATE POLICY user_blocks_select_admin ON public.user_blocks
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

-- Explicit grants: revoke everything first so a default privilege can never
-- leave anon (or PUBLIC) with a door (F-62 / 20260910_0043).
REVOKE ALL ON public.user_blocks FROM PUBLIC;
REVOKE ALL ON public.user_blocks FROM anon;
REVOKE ALL ON public.user_blocks FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;

-- Tell the moderation team. One admin_notifications row per block: who blocked
-- whom, so an admin can open the blocked member's recent content and review it.
CREATE OR REPLACE FUNCTION public.notify_admin_user_blocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _blocker text;
  _blocked text;
BEGIN
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

REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM anon;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM authenticated;

DROP TRIGGER IF EXISTS user_blocks_notify_admin ON public.user_blocks;
CREATE TRIGGER user_blocks_notify_admin
  AFTER INSERT ON public.user_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_user_blocked();

COMMIT;
