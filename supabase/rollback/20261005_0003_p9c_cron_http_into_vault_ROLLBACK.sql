-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261005_0003 — P9-c
-- Each of the six jobs that 0003 moved gets back its previous schedule and
-- command, byte for byte, from vault 'p9_cron_previous:<job>' (the commands
-- carry secrets, so 0003 never put them in a table). Then 0003's vault secrets
-- and public.cron_http_call() are removed. A job 0003 skipped is not touched.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires cron_http_call.
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
  IF to_regprocedure('public.cron_http_call(text)') IS NULL THEN
    RAISE EXCEPTION 'P9c-0003-RB-PRE-001: 20261005_0003 is not applied — nothing to roll back' USING ERRCODE = 'raise_exception';
  END IF;
  -- A job still calling cron_http_call must have its previous form in vault.
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'public\.cron_http_call\('
               AND NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:' || jobname)) THEN
    RAISE EXCEPTION 'P9c-0003-RB-PRE-002: a job calls cron_http_call but its previous form is not in vault — refusing to guess it'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DO $restore$
DECLARE
  _job text;
  _p   jsonb;
BEGIN
  FOREACH _job IN ARRAY ARRAY['apply-scheduled-boosts', 'autoscale-ad-traffic', 'expire-gift-credits',
                              'judging-invariants-nightly', 'send-reengagement-emails', 'backup-reminder'] LOOP
    SELECT decrypted_secret::jsonb INTO _p FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:' || _job;
    IF _p IS NOT NULL THEN
      PERFORM cron.schedule(_job, _p->>'schedule', _p->>'command');
    END IF;
  END LOOP;
END
$restore$;

DELETE FROM vault.secrets WHERE name IN (
  'p9_cron_http:apply-scheduled-boosts', 'p9_cron_http:autoscale-ad-traffic', 'p9_cron_http:expire-gift-credits',
  'p9_cron_http:judging-invariants-nightly', 'p9_cron_http:send-reengagement-emails', 'p9_cron_http:backup-reminder',
  'p9_cron_previous:apply-scheduled-boosts', 'p9_cron_previous:autoscale-ad-traffic', 'p9_cron_previous:expire-gift-credits',
  'p9_cron_previous:judging-invariants-nightly', 'p9_cron_previous:send-reengagement-emails', 'p9_cron_previous:backup-reminder');
DROP FUNCTION public.cron_http_call(text);

DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'cron_http_call') THEN
    RAISE EXCEPTION 'P9c-0003-RB-POST-001: a job still calls cron_http_call' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P9c-0003-RB: the six jobs are as before 0003';
END
$postconditions$;

COMMIT;
