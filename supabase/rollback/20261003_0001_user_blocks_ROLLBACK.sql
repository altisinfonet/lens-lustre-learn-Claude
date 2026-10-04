-- Rollback for 20261003_0001_user_blocks.sql. Drops the table (and with it the
-- policies, index and trigger) and the trigger function. Existing
-- admin_notifications rows of type 'user_blocked' are left in place.
BEGIN;
DROP TRIGGER IF EXISTS user_blocks_notify_admin ON public.user_blocks;
DROP TABLE IF EXISTS public.user_blocks;
DROP FUNCTION IF EXISTS public.notify_admin_user_blocked();
COMMIT;
