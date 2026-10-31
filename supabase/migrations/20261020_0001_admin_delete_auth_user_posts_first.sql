-- ═══════════════════════════════════════════════════════════════════════════
-- 20261020_0001 · LIVE FIX: admin "Delete user" fails for any member who has a
-- post stored through media_objects/post_media.
--
-- MEASURED (production, PROBE_diag_20261020_admin_delete_suspend.sql, run
-- 39378598771, 2026-10-20): admin_delete_auth_user → DELETE FROM auth.users →
--   23503 update or delete on table "media_objects" violates foreign key
--   constraint "post_media_media_id_fkey" on table "post_media".
-- CAUSE: the account cascade removes the member's media_objects (owner_id →
-- auth.users ON DELETE CASCADE), but public.posts has NO foreign key to the
-- member, so the member's posts — and their post_media rows (post_id → posts
-- CASCADE) — are still there; post_media.media_id → media_objects is ON DELETE
-- RESTRICT (20260814084711_media_objects.sql:114) and refuses. delete-user only
-- deletes the posts AFTER this function returns (index.ts ~L88-99).
--
-- FIX (review #472): keep the RESTRICT protection; this function now deletes the
-- member's own posts FIRST (cascading post_media and every other post child —
-- all FKs to posts are CASCADE on live, snapshot 2026-10-17), then the auth user.
-- delete-user deleted those same posts a moment later anyway, so the end state is
-- identical. If ANOTHER member's post uses this member's media, the delete is
-- still refused (correct). Body otherwise unchanged from live; grants unchanged
-- (CREATE OR REPLACE keeps them).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE _src text;
BEGIN
  SELECT p.prosrc INTO _src FROM pg_proc p WHERE p.oid = to_regprocedure('public.admin_delete_auth_user(uuid)');
  IF _src IS NULL THEN
    RAISE EXCEPTION 'ADAU-0001-PRE: public.admin_delete_auth_user(uuid) not found' USING ERRCODE = 'raise_exception';
  END IF;
  IF _src LIKE '%DELETE FROM public.posts WHERE user_id = _uid%' THEN
    RAISE EXCEPTION 'ADAU-0001-PRE: already applied (function deletes posts first)' USING ERRCODE = 'raise_exception';
  END IF;
  IF _src NOT LIKE '%DELETE FROM auth.users WHERE id = _uid%' OR _src NOT LIKE '%app.bypass_round_lock%' THEN
    RAISE EXCEPTION 'ADAU-0001-PRE: admin_delete_auth_user body is not the expected live form — inspect before replacing' USING ERRCODE = 'raise_exception';
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
  -- 20261020_0001: the member's own posts go FIRST. posts has no FK to the member,
  -- so without this the cascade below removes their media_objects while their
  -- post_media rows still point at them → post_media_media_id_fkey (RESTRICT) 23503.
  DELETE FROM public.posts WHERE user_id = _uid;
  DELETE FROM auth.users WHERE id = _uid;
  RETURN FOUND;  -- true if a row was deleted
END;
$function$;

DO $post$
BEGIN
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.admin_delete_auth_user(uuid)'))
     NOT LIKE '%DELETE FROM public.posts WHERE user_id = _uid%' THEN
    RAISE EXCEPTION 'ADAU-0001-POST: function body not replaced' USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.admin_delete_auth_user(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_delete_auth_user(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ADAU-0001-POST: anon/authenticated must NOT be able to EXECUTE admin_delete_auth_user (live ACL 2026-10-17: postgres + service_role only)' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'ADAU-0001: admin_delete_auth_user deletes the member''s posts before the auth user (post_media RESTRICT no longer blocks account delete)';
END
$post$;

COMMIT;
