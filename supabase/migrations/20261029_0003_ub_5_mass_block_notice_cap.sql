-- S8 / UB-5 · mass-block cap on the admin notice fan-out.
--
-- 20261003_0002 capped notices at one per (blocker, blocked) PAIR per 24 h and
-- said plainly: "Mass-blocking of MANY distinct members is NOT capped here".
-- One member blocking 500 others still wrote 500 admin_notifications rows.
-- This caps it at 10 notices per BLOCKER per 24 h; the 10th says so and names
-- the blocker, so the pattern itself reaches the admin once. Blocking is never
-- refused. Body otherwise identical to 0002 (pair claim, message text).
-- The count is per NEW.blocker_id (cross-member: one member's blocks never
-- consume another's allowance). Two concurrent inserts by the same blocker can
-- each see 9 and both notify — bounded at cap+1 per race, acceptable for a
-- notice cap.
-- Rollback: supabase/rollback/20261029_0003_ub_5_mass_block_notice_cap_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_s8_ub_5_mass_block_notice_cap.sql
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.user_block_notices') IS NULL
     OR to_regprocedure('public.notify_admin_user_blocked()') IS NULL THEN
    RAISE EXCEPTION 'UB-5-PRE-001: 20261003_0002 is not applied on this lane (no user_block_notices / trigger function) — apply it first'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$pre$;

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
  _recent  int;
  _cap     constant int := 10;   -- UB-5: notices per blocker per 24 h
BEGIN
  -- UB-5: mass-blocking cap. The BLOCK always succeeds (it is a member's
  -- safety tool); only the admin notice fan-out is capped. A blocker who has
  -- already produced _cap notices in 24 h produces no more until the window
  -- moves. The pair slot is not claimed either, so that pair can still be
  -- notified later. Scoped by NEW.blocker_id: one member's activity never
  -- uses up another member's allowance.
  SELECT count(*) INTO _recent
    FROM public.user_block_notices
   WHERE blocker_id = NEW.blocker_id
     AND notified_at > now() - interval '24 hours';
  IF _recent >= _cap THEN
    RETURN NEW;
  END IF;

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

  SELECT full_name INTO _blocker FROM public.profiles WHERE id = NEW.blocker_id;
  SELECT full_name INTO _blocked FROM public.profiles WHERE id = NEW.blocked_id;

  INSERT INTO public.admin_notifications (type, title, message, reference_id)
  VALUES (
    'user_blocked',
    'Member blocked by another member',
    COALESCE(_blocker, 'A member') || ' blocked ' || COALESCE(_blocked, 'a member')
      || ' (user ' || NEW.blocked_id::text || '). Review that member''s recent posts and comments for objectionable content.'
      || CASE WHEN _recent + 1 = _cap
              THEN ' This is their ' || _cap || 'th block notice in 24 hours; further blocks by them (user '
                   || NEW.blocker_id::text || ') are not notified until the window moves (UB-5 cap).'
              ELSE '' END,
    NEW.blocked_id
  );
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM anon;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM authenticated;

DO $post$
DECLARE fn text;
BEGIN
  SELECT prosrc INTO fn FROM pg_proc WHERE oid = 'public.notify_admin_user_blocked()'::regprocedure;
  IF fn NOT LIKE '%UB-5%' OR fn NOT LIKE '%user_block_notices%' OR fn NOT LIKE '%interval ''24 hours''%' THEN
    RAISE EXCEPTION 'UB-5-POST-001: notify_admin_user_blocked() does not carry both caps' USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.notify_admin_user_blocked()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notify_admin_user_blocked()', 'EXECUTE') THEN
    RAISE EXCEPTION 'UB-5-POST-002: notify_admin_user_blocked() is executable by an API role' USING ERRCODE = 'raise_exception';
  END IF;
END
$post$;

COMMIT;
