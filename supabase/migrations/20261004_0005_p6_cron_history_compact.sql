-- ═══════════════════════════════════════════════════════════════════════════
-- P6 · 20261004_0005 — one-time: purge now, then VACUUM FULL cron.job_run_details
-- MAINTENANCE, NOT SCHEMA. Lanes: staging and production. Apply AFTER 20261004_0004.
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY. Deleting rows frees space INSIDE the file; it does not give it back. The
-- oldest rows sit at the front of the file and new runs keep writing at the end,
-- so a plain VACUUM cannot truncate it: on staging the file stays 182 MB however
-- many rows are purged. VACUUM FULL rewrites it with only the live rows.
--
-- NO BEGIN/COMMIT, BY DESIGN. Both statements refuse to run in a transaction
-- block: the procedure COMMITs between batches, and VACUUM cannot run in one.
-- apply-migration.yml runs this file with psql -f and no -1, so each statement
-- autocommits, in order, in one session (same as 20260920_0003). The lane
-- assertion is the first statement; if it raises, ON_ERROR_STOP ends the session.
--
-- LOCK. VACUUM FULL holds ACCESS EXCLUSIVE on cron.job_run_details for the
-- rewrite. After the purge it holds ≤ 36 h of rows; pg_cron writes a row at each
-- job start and end, so a job starting during the rewrite waits for it. lock_timeout
-- 5 s: if a lock is already held, the file stops instead of queueing (re-run it).
-- PRIVILEGE. The table is owned by supabase_admin; postgres holds MAINTAIN (m) on
-- it (staging ACL read 2026-10-04 08:25 UTC), which VACUUM FULL needs on PG17.
-- ROLLBACK: none — removing dead space has no prior state to restore. Rows purged
-- are older than 36 h by the gate's rule; 20261004_0004's rollback restores the job.
-- ═══════════════════════════════════════════════════════════════════════════

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.purge_cron_run_details(interval,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED — 20261004_0004 is not applied (purge_cron_run_details missing)'
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

CALL public.purge_cron_run_details();

SET lock_timeout = '5s';

VACUUM (FULL, ANALYZE) cron.job_run_details;
