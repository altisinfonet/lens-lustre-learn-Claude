-- ROLLBACK · P35 · 20261004_0003 — drops ONLY the two indexes that file created.
-- These are D1's own new indexes, not pre-existing ones, so the C-2 hold on index
-- drops does not apply. No data is touched. Lane guard: staging | production.
BEGIN;
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %).',
      coalesce(current_setting('p32.lane', true), '(unset)') USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;
SET LOCAL lock_timeout = '5s';
DROP INDEX IF EXISTS public.idx_post_hashtags_author_id;
DROP INDEX IF EXISTS public.idx_user_block_notices_blocked_id;
COMMIT;
