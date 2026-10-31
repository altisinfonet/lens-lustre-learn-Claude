-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · P6 · 20261004_0004 — the purge job back to what it was; procedure dropped
-- Restores 'purge-cron-history' EXACTLY as saved in public.p6_cron_previous (on
-- staging: daily 0 3 * * *, the unbounded 7-day delete), or unschedules it if it
-- did not exist before. Purged rows are not restored (they were older than 36 h;
-- there is no copy and the gate requires them gone). p6_cron_previous is kept.
-- Lane guard: staging | production. NOT RE-RUNNABLE (RB-PRE-001).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %).',
      coalesce(current_setting('p32.lane', true), '(unset)') USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;
DO $preconditions$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-history' AND command ~* 'purge_cron_run_details') THEN
    RAISE EXCEPTION 'P6-0004-RB-PRE-001: purge-cron-history does not call purge_cron_run_details — nothing to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regclass('public.p6_cron_previous') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.p6_cron_previous WHERE jobname = 'purge-cron-history') THEN
    RAISE EXCEPTION 'P6-0004-RB-PRE-002: the saved previous job is missing; refusing to guess it' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;
SELECT cron.schedule(p.jobname, p.schedule, p.command) FROM public.p6_cron_previous p
 WHERE p.jobname = 'purge-cron-history' AND p.existed;
SELECT cron.unschedule('purge-cron-history') FROM public.p6_cron_previous p
 WHERE p.jobname = 'purge-cron-history' AND NOT p.existed;
DROP PROCEDURE public.purge_cron_run_details(interval, integer, integer);
DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM public.p6_cron_previous WHERE jobname = 'purge-cron-history' AND existed)
     AND NOT EXISTS (SELECT 1 FROM cron.job j JOIN public.p6_cron_previous p USING (jobname)
                      WHERE j.jobname = 'purge-cron-history' AND j.schedule = p.schedule AND j.command = p.command) THEN
    RAISE EXCEPTION 'P6-0004-RB-POST-001: purge-cron-history does not match the saved job' USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;
COMMIT;
