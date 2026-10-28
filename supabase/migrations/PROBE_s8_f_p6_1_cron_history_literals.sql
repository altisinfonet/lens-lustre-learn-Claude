-- PROBE (read-only) · S8 / F-P6-1 — are literal credentials still in the
-- scheduler's run history, and is the root (P9: no literal in cron.job) fixed?
-- Prints job names and COUNTS only. Never prints a command.
--   R1 · no cron.job command holds a quoted literal of 17+ chars (other than
--        its own job name)          — the root, P9 (same test as PROBE_p9c C2)
--   H1 · no cron.job_run_details row holds such a literal — the stock
--   P6 · the 36 h retention job is scheduled (purge_cron_run_details), so any
--        stock left after R1 passes ages out on its own
-- OVERALL PASS = R1 and H1. FAILS before the purge (20261029_0001) on a lane
-- whose history still holds literals; PASSES after.
BEGIN READ ONLY;

WITH lit AS (
  SELECT d.jobid, j.jobname
    FROM cron.job_run_details d
    LEFT JOIN cron.job j ON j.jobid = d.jobid
   WHERE EXISTS (SELECT 1 FROM regexp_matches(d.command, '''((?:[^'']|'''')*)''', 'g') m
                  WHERE length(m[1]) >= 17
                    AND m[1] NOT IN (SELECT jobname FROM cron.job WHERE jobname IS NOT NULL))
), root AS (
  SELECT j.jobname
    FROM cron.job j
   WHERE EXISTS (SELECT 1 FROM regexp_matches(j.command, '''((?:[^'']|'''')*)''', 'g') m
                  WHERE length(m[1]) >= 17 AND m[1] IS DISTINCT FROM j.jobname)
)
SELECT 'R1 cron.job commands with a 17+ literal' AS check, count(*)::text AS value,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result FROM root
UNION ALL
SELECT 'R1 job names (no command shown)', coalesce(string_agg(jobname, ', ' ORDER BY jobname), '-'), '' FROM root
UNION ALL
SELECT 'H1 run-history rows with a 17+ literal', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END FROM lit
UNION ALL
SELECT 'H1 rows per job', coalesce(string_agg(x, ', '), '-'), '' FROM
  (SELECT coalesce(jobname, '(deleted job ' || jobid || ')') || '=' || count(*) AS x
     FROM lit GROUP BY jobid, jobname ORDER BY 1) s
UNION ALL
SELECT 'P6 retention job scheduled', (count(*) > 0)::text,
       CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'INFO' END
  FROM cron.job WHERE command ILIKE '%purge_cron_run_details%' AND active;

ROLLBACK;
