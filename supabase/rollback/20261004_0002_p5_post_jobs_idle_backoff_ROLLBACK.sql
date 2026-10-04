-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · P5 · 20261004_0002 — back to the job's previous schedule and command
-- Undoes supabase/migrations/20261004_0002_p5_post_jobs_idle_backoff.sql.
--
-- Restores 'process-post-jobs' to EXACTLY the schedule and command the apply
-- saved in public.p5_cron_previous on this lane (on staging: '5 seconds',
-- "SELECT public.process_post_jobs(100);"), then drops drain_post_jobs().
-- public.p5_cron_previous is KEPT (it holds only that saved row; a re-apply
-- reuses it). process_post_jobs() was never changed, so nothing else to undo.
--
-- LANE GUARD: the session asserts p32.lane (staging | production); this file never sets it.
-- NOT RE-RUNNABLE: RB-PRE-001 requires the job to be calling drain_post_jobs.
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
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-post-jobs' AND command ~* 'drain_post_jobs') THEN
    RAISE EXCEPTION 'P5-0002-RB-PRE-001: process-post-jobs is not calling drain_post_jobs — nothing to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regclass('public.p5_cron_previous') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.p5_cron_previous WHERE jobname = 'process-post-jobs') THEN
    RAISE EXCEPTION 'P5-0002-RB-PRE-002: the saved previous schedule is missing; refusing to guess it'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

SELECT cron.schedule(p.jobname, p.schedule, p.command)
  FROM public.p5_cron_previous p WHERE p.jobname = 'process-post-jobs';

DROP FUNCTION public.drain_post_jobs(integer, interval);

DO $postconditions$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job j JOIN public.p5_cron_previous p USING (jobname)
                  WHERE j.jobname = 'process-post-jobs' AND j.schedule = p.schedule AND j.command = p.command) THEN
    RAISE EXCEPTION 'P5-0002-RB-POST-001: process-post-jobs does not match the saved schedule and command'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
