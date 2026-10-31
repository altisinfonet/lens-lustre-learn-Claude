-- ROLLBACK of 20261020_0001: restore admin_delete_auth_user without the posts-first
-- delete (the live body of 2026-10-17). Restores the bug: Delete user fails again
-- for members with post_media rows.
BEGIN;
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;
DO $pre$
BEGIN
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.admin_delete_auth_user(uuid)'))
     NOT LIKE '%DELETE FROM public.posts WHERE user_id = _uid%' THEN
    RAISE EXCEPTION 'ADAU-0001-RB-PRE: 20261020_0001 is not applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$pre$;
CREATE OR REPLACE FUNCTION public.admin_delete_auth_user(_uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'admin_delete_auth_user: _uid required';
  END IF;
  -- Account deletion is a trusted internal operation: allow the cascade to remove
  -- this user's judging rows even for rounds locked as 'completed'
  -- (enforce_round_lock). Transaction-local; does not leak beyond this delete.
  PERFORM set_config('app.bypass_round_lock', 'on', true);
  -- clear the one FK to auth.users that is NO ACTION (would block the delete)
  UPDATE public.role_applications SET reviewed_by = NULL WHERE reviewed_by = _uid;
  DELETE FROM auth.users WHERE id = _uid;
  RETURN FOUND;  -- true if a row was deleted
END;
$function$;
COMMIT;
