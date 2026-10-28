-- ROLLBACK for 20261029_0003 (UB-5). Restores notify_admin_user_blocked()
-- exactly as 20261003_0002 defined it (pair cap only, no per-blocker cap).
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

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

REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM anon;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM authenticated;

COMMIT;
