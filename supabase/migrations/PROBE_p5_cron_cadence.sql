-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P5 · no scheduled job runs more often than once a minute — LIVE half.
-- READ-ONLY. Ends in ROLLBACK. Raises (fails the dispatch) on a hit.
--
-- pg_cron accepts two schedule forms: five-field cron (never more often than
-- once a minute) and '<n> seconds' (1–59 s). Every '<n> seconds' job is a hit
-- unless it is named below with the evidence that it is saturated (gate:
-- "unless it is demonstrably saturated"). Today no job is: the list is empty.
-- The build-time half is scripts/db-p5-cron-cadence-check.mjs (git's jobs).
-- Also a hit: a worker job whose command is not idle-guarded — today that is
-- process-post-jobs calling process_post_jobs() directly instead of
-- drain_post_jobs() (20261004_0002).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  -- jobname → path of the saturation evidence. Empty today.
  saturated text[] := ARRAY[]::text[];
  hits text;
BEGIN
  SELECT string_agg(jobname || ' [' || schedule || ']', ', ' ORDER BY jobname) INTO hits
    FROM cron.job
   WHERE active AND schedule ~* '^\s*\d+\s+seconds?\s*$' AND NOT (jobname = ANY (saturated));
  IF hits IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P5: job(s) run more often than once a minute: %', hits;
  END IF;
  SELECT string_agg(jobname, ', ') INTO hits
    FROM cron.job WHERE active AND jobname = 'process-post-jobs' AND command !~* 'drain_post_jobs';
  IF hits IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P5: % calls the worker without idle back-off (expected drain_post_jobs)', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS P5: no job runs more often than once a minute; the post-jobs worker backs off when idle';
END
$probe$;
ROLLBACK;
