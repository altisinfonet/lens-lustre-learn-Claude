-- PROBE (read-only) · S8 / F-P5-1 — is staging's process-post-jobs still
-- failing every run? 20261004_0002 (P5) made the job call drain_post_jobs(),
-- which returns {"idle": true} when the queue post_jobs does not exist.
-- Prints counts only (never a command or a return message).
-- PASS = the job calls drain_post_jobs AND it has runs in the last 6 h AND
-- none of them failed.
BEGIN READ ONLY;

WITH j AS (
  SELECT jobid, schedule, (command ~* 'drain_post_jobs') AS drains
    FROM cron.job WHERE jobname = 'process-post-jobs'
), r AS (
  SELECT d.status, count(*) AS n
    FROM cron.job_run_details d JOIN j USING (jobid)
   WHERE d.start_time > now() - interval '6 hours'
   GROUP BY d.status
)
SELECT 'job exists' AS check, (SELECT count(*) FROM j)::text AS value
UNION ALL SELECT 'schedule', coalesce((SELECT schedule FROM j), '-')
UNION ALL SELECT 'command calls drain_post_jobs (P5 applied)', coalesce((SELECT drains::text FROM j), '-')
UNION ALL SELECT 'queue pgmq.q_post_jobs exists', (to_regclass('pgmq.q_post_jobs') IS NOT NULL)::text
UNION ALL SELECT 'runs last 6 h, status=' || status, n::text FROM r
UNION ALL
SELECT 'OVERALL',
  CASE WHEN coalesce((SELECT drains FROM j), false)
        AND coalesce((SELECT sum(n) FROM r), 0) > 0
        AND coalesce((SELECT sum(n) FROM r WHERE status = 'failed'), 0) = 0
       THEN 'PASS' ELSE 'FAIL' END;

ROLLBACK;
