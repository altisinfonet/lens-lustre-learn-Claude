-- Rollback for 20261003_0001_user_blocks.sql. Drops the table (and with it the
-- policies, index and trigger) and the trigger function. Existing
-- admin_notifications rows of type 'user_blocked' are left in place.
-- ⛔ S8 / UB-6 (2026-10-28): DO NOT RUN. THIS FILE IS UNRUNNABLE BY DESIGN.
-- DROP TABLE public.user_blocks destroys every member's block list — data,
-- not machinery — and 20261003_0002 (hardening) is layered on the table, so
-- this is not a rollback of anything still live, it is deletion. The guard
-- below refuses unconditionally, inside the transaction, so nothing after it
-- can run (ON_ERROR_STOP stops psql; without it the aborted transaction
-- refuses every later statement). To undo 0002 use
-- 20261003_0002_user_blocks_hardening_ROLLBACK.sql. Removing the table, if
-- ever wanted, is a separate decision with its own export-first plan.
BEGIN;
DO $unrunnable$
BEGIN
  RAISE EXCEPTION 'ROLLBACK REFUSED — 20261003_0001_user_blocks_ROLLBACK is unrunnable (UB-6): it would DROP every member''s blocks.'
    USING ERRCODE = 'raise_exception';
END
$unrunnable$;
DROP TRIGGER IF EXISTS user_blocks_notify_admin ON public.user_blocks;
DROP TABLE IF EXISTS public.user_blocks;
DROP FUNCTION IF EXISTS public.notify_admin_user_blocked();
COMMIT;
