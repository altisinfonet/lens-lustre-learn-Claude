-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · VID-1 20261013_0007 — converter account provisioning.
-- Puts the lane back exactly as it was before 0007: the converter account is
-- no longer listed (every converter RPC refuses again), its profile is no
-- longer banned or hidden, its 'user' role row is back if it had one (the
-- listing's note recorded that), and the trigger tg_user_roles_no_converter
-- and its function are gone.
--
-- READ BEFORE RUNNING:
--   • stop the worker on the VM first: this file refuses while a conversion
--     holds a live claim.
--   • afterwards the Auth user is an ordinary member again, and its password
--     is still on the VM. Unless 0007 is re-applied at once, the Owner deletes
--     that user in Supabase → Authentication → Users.
--   • this file never reads or writes a password, a hash or a token.
-- ORDER: this file BEFORE 20261012_0002's rollback (which drops the table).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $rollback$
DECLARE
  _a record;
BEGIN
  IF to_regclass('public.video_converter_accounts') IS NULL THEN
    RAISE EXCEPTION 'VID-ACC-RB-001: video_converter_accounts is not on this lane — nothing to roll back';
  END IF;
  IF to_regprocedure('public.tg_user_roles_no_converter()') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.video_converter_accounts) THEN
    RAISE EXCEPTION 'VID-ACC-RB-002: 20261013_0007 is not applied — nothing to roll back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_converter_accounts WHERE note NOT LIKE 'VID-1 converter account · 20261013_0007 · before: user_role=%') THEN
    RAISE EXCEPTION 'VID-ACC-RB-003: a converter account that 20261013_0007 did not list is here — read it before removing anything';
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_sources WHERE status = 'converting' AND lease_until > now()) THEN
    RAISE EXCEPTION 'VID-ACC-RB-004: a conversion holds a live claim — stop the worker and wait for it to end first';
  END IF;

  DROP TRIGGER IF EXISTS tg_user_roles_no_converter ON public.user_roles;
  DROP FUNCTION IF EXISTS public.tg_user_roles_no_converter();

  FOR _a IN SELECT user_id, note FROM public.video_converter_accounts LOOP
    DELETE FROM public.video_converter_accounts WHERE user_id = _a.user_id;
    UPDATE public.profiles SET is_banned = false, is_suspended = false WHERE id = _a.user_id;
    IF _a.note LIKE '%user_role=yes' THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_a.user_id, 'user') ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
    RAISE NOTICE 'VID-ACC rollback: the account is unlisted, un-banned and visible again (% ) — delete the Auth user unless 0007 is re-applied now', _a.note;
  END LOOP;
END
$rollback$;

COMMIT;
