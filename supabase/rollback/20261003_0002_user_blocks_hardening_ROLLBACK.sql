-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261003_0002 — user_blocks hardening
-- Undoes supabase/migrations/20261003_0002_user_blocks_hardening.sql and
-- returns user_blocks to exactly the 20261003_0001 state.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES
--   * drops the merged SELECT policy and the three restrictive live-account
--     guards; recreates 0001's two SELECT policies with 0001's exact text;
--   * restores notify_admin_user_blocked() to 0001's exact body (one notice per
--     INSERT, no cap) and restates its revokes.
--
-- WHAT IT DOES NOT DO — BY DESIGN (SEC-UB-5, R-72.5: never a bare DROP of data)
--   * public.user_blocks is NOT touched: no member's block list is lost and no
--     blocked content reappears.
--   * public.user_block_notices is KEPT, rows and all. After this rollback
--     nothing reads or writes it. A re-apply of 0002 reuses it (CREATE TABLE IF
--     NOT EXISTS). Dropping it is a separate, later decision, with the rows
--     copied out first.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- apply-migration.yml sets it from its own lane guard (R-13).
--
-- NOT RE-RUNNABLE. RB-PRE-001 requires exactly the 0002 policy set.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  pols text;
BEGIN
  SELECT string_agg(policyname || ':' || permissive || ':' || cmd, ',' ORDER BY policyname) INTO pols
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_blocks';
  IF pols IS DISTINCT FROM
     'Deleted accounts cannot delete:RESTRICTIVE:DELETE,Deleted accounts cannot insert:RESTRICTIVE:INSERT,'
     'Deleted accounts cannot update:RESTRICTIVE:UPDATE,user_blocks_delete_own:PERMISSIVE:DELETE,'
     'user_blocks_insert_own:PERMISSIVE:INSERT,user_blocks_select:PERMISSIVE:SELECT' THEN
    RAISE EXCEPTION 'UB-0002-RB-PRE-001: user_blocks policies are (%), not the 0002 set — '
      'nothing to roll back, or something other than 20261003_0002 changed them; re-read first',
      coalesce(pols, 'none')
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DROP POLICY user_blocks_select ON public.user_blocks;
DROP POLICY "Deleted accounts cannot insert" ON public.user_blocks;
DROP POLICY "Deleted accounts cannot update" ON public.user_blocks;
DROP POLICY "Deleted accounts cannot delete" ON public.user_blocks;

-- 0001's two SELECT policies, verbatim.
CREATE POLICY user_blocks_select_own ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

CREATE POLICY user_blocks_select_admin ON public.user_blocks
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- 0001's function body, verbatim.
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

DO $postconditions$
DECLARE
  pols text;
BEGIN
  SELECT string_agg(policyname || ':' || permissive || ':' || cmd, ',' ORDER BY policyname) INTO pols
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_blocks';
  IF pols IS DISTINCT FROM
     'user_blocks_delete_own:PERMISSIVE:DELETE,user_blocks_insert_own:PERMISSIVE:INSERT,'
     'user_blocks_select_admin:PERMISSIVE:SELECT,user_blocks_select_own:PERMISSIVE:SELECT' THEN
    RAISE EXCEPTION 'UB-0002-RB-POST-001: user_blocks policies are (%), not the four of 20261003_0001',
      coalesce(pols, 'none')
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.notify_admin_user_blocked()'::regprocedure)
     LIKE '%user_block_notices%' THEN
    RAISE EXCEPTION 'UB-0002-RB-POST-002: notify_admin_user_blocked() still carries the 0002 cap'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
