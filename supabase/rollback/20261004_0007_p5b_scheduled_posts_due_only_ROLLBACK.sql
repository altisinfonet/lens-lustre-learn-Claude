-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261004_0007 — publish-scheduled-posts only when due
-- Returns the lane to exactly its pre-0007 state:
--   * cron job 'publish-scheduled-posts' gets back its previous schedule and
--     command, byte for byte, from vault secret
--     'p9_cron_previous:publish-scheduled-posts' (the command may carry secrets,
--     so 0007 kept it in vault, never in a table). On a lane where 0007 found
--     no job, none is created;
--   * the tick, the due-check, the state table (one row of counters), the new
--     partial index and 0007's two vault secrets are removed. No member data is
--     touched: public.scheduled_posts' rows are not read or changed.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires 0007 to be applied.
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
BEGIN
  IF to_regprocedure('public.publish_scheduled_posts_tick()') IS NULL THEN
    RAISE EXCEPTION 'P5b-0007-RB-PRE-001: 20261004_0007 is not applied — nothing to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-scheduled-posts')
     AND NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:publish-scheduled-posts') THEN
    RAISE EXCEPTION 'P5b-0007-RB-PRE-002: publish-scheduled-posts exists but its previous form is not in vault — refusing to guess it'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DO $job$
DECLARE _p jsonb;
BEGIN
  SELECT decrypted_secret::jsonb INTO _p FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:publish-scheduled-posts';
  IF _p IS NOT NULL THEN
    PERFORM cron.schedule('publish-scheduled-posts', _p->>'schedule', _p->>'command');
  END IF;
END
$job$;

DROP FUNCTION public.publish_scheduled_posts_tick();
DROP FUNCTION public.scheduled_posts_due();
DROP TABLE public.publish_scheduled_posts_tick_state;
DROP INDEX IF EXISTS public.idx_scheduled_posts_publishing_stale;
DELETE FROM vault.secrets WHERE name IN ('p9_cron_http:publish-scheduled-posts', 'p9_cron_previous:publish-scheduled-posts');

DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-scheduled-posts' AND command ~* 'publish_scheduled_posts_tick')
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'p9\_cron\_%:publish-scheduled-posts') THEN
    RAISE EXCEPTION 'P5b-0007-RB-POST-001: the job still calls the tick, or a 0007 vault secret remains' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P5b-0007-RB: publish-scheduled-posts is as before 0007';
END
$postconditions$;

COMMIT;
