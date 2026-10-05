-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261005_0002 — user-block notice purge
-- Unschedules 'purge-user-block-notices' and drops purge_user_block_notices().
-- The ledger rows already purged are NOT restored, by design: each was at least
-- 24 h old, so it gated nothing (see the migration header); the cap works the
-- same without it. public.user_block_notices itself is untouched.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires 0002 to be applied.
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

DO $preconditions$
BEGIN
  IF to_regprocedure('public.purge_user_block_notices(interval,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'UB0003-RB-PRE-001: 20261005_0002 is not applied — nothing to roll back' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-user-block-notices';
DROP FUNCTION public.purge_user_block_notices(interval, integer, integer);

DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-user-block-notices')
     OR to_regprocedure('public.purge_user_block_notices(interval,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'UB0003-RB-POST-001: the purge job or function remains' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'UB0003-RB: purge removed; the ledger and the cap are as after 20261003_0002';
END
$postconditions$;

COMMIT;
