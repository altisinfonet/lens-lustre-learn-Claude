-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261004_0006 — the e-mail queue wake
-- Returns the lane to exactly its pre-0006 state:
--   * cron job 'process-email-queue' gets back its previous schedule and
--     command, byte for byte, from vault secret
--     'p9_cron_previous:process-email-queue' (the command carries secrets, so
--     0006 kept it in vault, never in a table). On a lane where 0006 found no
--     job, there is nothing to restore and none is created;
--   * public.delete_email gets back its previous definition (saved by 0006 in
--     email_queue_wake_state.prev_delete_email);
--   * the two triggers, the four functions, the state table and 0006's two
--     vault secrets are removed. None of them holds member data: the state
--     table is one row of counters; the queue tables and their messages are
--     not touched.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires 0006 to be applied.
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
  IF to_regprocedure('public.email_queue_wake(text)') IS NULL OR to_regclass('public.email_queue_wake_state') IS NULL THEN
    RAISE EXCEPTION 'P9-0006-RB-PRE-001: 20261004_0006 is not applied — nothing to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue')
     AND NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:process-email-queue') THEN
    RAISE EXCEPTION 'P9-0006-RB-PRE-002: process-email-queue exists but its previous form is not in vault — refusing to guess it'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- 1. the job, exactly as it was
DO $job$
DECLARE _p jsonb;
BEGIN
  SELECT decrypted_secret::jsonb INTO _p FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:process-email-queue';
  IF _p IS NOT NULL THEN
    PERFORM cron.schedule('process-email-queue', _p->>'schedule', _p->>'command');
  END IF;
END
$job$;

-- 2. delete_email, exactly as it was
DO $fn$
DECLARE _d text;
BEGIN
  SELECT prev_delete_email INTO _d FROM public.email_queue_wake_state;
  EXECUTE _d;
END
$fn$;

-- 3. the wake
DROP TRIGGER IF EXISTS p9_email_wake ON pgmq.q_auth_emails;
DROP TRIGGER IF EXISTS p9_email_wake ON pgmq.q_transactional_emails;
DROP FUNCTION public.email_queue_wake_trg();
DROP FUNCTION public.email_queue_tick();
DROP FUNCTION public.email_queue_wake(text);
DROP FUNCTION public.email_queue_has_work(text);
DROP TABLE public.email_queue_wake_state;
DELETE FROM vault.secrets WHERE name IN ('p9_cron_http:process-email-queue', 'p9_cron_previous:process-email-queue');

DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue' AND command ~* 'email_queue_tick') THEN
    RAISE EXCEPTION 'P9-0006-RB-POST-001: process-email-queue still calls email_queue_tick()' USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'p9_email_wake')
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'p9\_cron\_%:process-email-queue') THEN
    RAISE EXCEPTION 'P9-0006-RB-POST-002: a p9_email_wake trigger or a 0006 vault secret remains' USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.delete_email(text,bigint)'::regprocedure) LIKE '%not permitted%' THEN
    RAISE NOTICE 'P9-0006-RB: delete_email restored to its pre-0006 definition, which already carried an allow-list';
  END IF;
  RAISE NOTICE 'P9-0006-RB: process-email-queue, delete_email and the queues are as before 0006';
END
$postconditions$;

COMMIT;
