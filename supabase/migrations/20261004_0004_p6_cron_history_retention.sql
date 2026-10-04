-- ═══════════════════════════════════════════════════════════════════════════
-- P6 · 20261004_0004 — cron.job_run_details: 36-hour retention, bounded-batch purge
-- Phase 4 unit P6 (D1, T1). Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (GATE_REGISTER P6): "cron.job_run_details retention set to 24–48 hours;
-- purge runs in bounded batches; the table is no longer among the ten largest
-- in the database." Baseline (production): 202,082 rows / 76 MB of 135 MB.
-- Staging read-only 2026-10-04 08:25 UTC: 135,831 rows, 188 MB of a 224 MB
-- database — the LARGEST relation; 107,676 rows older than 36 h. The only purge
-- is job 'purge-cron-history' (not in git): daily, one unbounded
-- "delete from cron.job_run_details where end_time < now() - interval '7 days'".
--
-- WHAT THIS FILE DOES
--   1. public.purge_cron_run_details(_keep, _batch, _max_batches): a PROCEDURE.
--      Deletes rows whose end_time is older than _keep (default 36 h — inside
--      the gate's 24–48 h), oldest first by runid, _batch rows (default 5,000)
--      per statement, and COMMITs after every batch — so no single transaction
--      holds more than one batch of locks or one batch of WAL, and autovacuum can
--      reclaim behind it. Stops after _max_batches (default 200 = 1M rows) so one
--      run is bounded in time too. Rows with end_time NULL (still running) are
--      never touched.
--   2. Job 'purge-cron-history' → hourly at :17, "CALL public.purge_cron_run_details();".
--      Its previous schedule/command (if the job existed) is saved first in
--      public.p6_cron_previous for an exact rollback.
-- The one-time shrink of the file (VACUUM FULL) is a separate file,
-- 20261004_0005_p6_cron_history_compact.sql: VACUUM cannot run in a transaction.
--
-- DEPENDS ON nothing; WORKS BEST WITH P5 (20261004_0002), which removes the
-- 5-second job that writes ~90 % of the rows on staging.
-- OBJECTS: new public.purge_cron_run_details(interval,int,int); new
-- public.p6_cron_previous; cron job 'purge-cron-history'; cron.job_run_details (rows).
-- NOT RE-RUNNABLE: PRE-002 refuses once the job already calls the procedure.
-- ROLLBACK: supabase/rollback/20261004_0004_p6_cron_history_retention_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_p6_cron_history.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

DO $preconditions$
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RAISE EXCEPTION 'P6-0004-PRE-001: cron.job_run_details does not exist' USING ERRCODE = 'raise_exception';
  END IF;
  IF NOT has_table_privilege(current_user, 'cron.job_run_details', 'DELETE') THEN
    RAISE EXCEPTION 'P6-0004-PRE-001: % cannot DELETE from cron.job_run_details', current_user USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-history' AND command ~* 'purge_cron_run_details') THEN
    RAISE EXCEPTION 'P6-0004-PRE-002: purge-cron-history already calls purge_cron_run_details — already applied'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'purge-cron-history') > 1 THEN
    RAISE EXCEPTION 'P6-0004-PRE-003: more than one job named purge-cron-history' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

CREATE TABLE IF NOT EXISTS public.p6_cron_previous (
  jobname  text PRIMARY KEY,
  existed  boolean NOT NULL,
  schedule text,
  command  text,
  saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.p6_cron_previous ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.p6_cron_previous FROM PUBLIC;
REVOKE ALL ON public.p6_cron_previous FROM anon;
REVOKE ALL ON public.p6_cron_previous FROM authenticated;
INSERT INTO public.p6_cron_previous (jobname, existed, schedule, command)
SELECT 'purge-cron-history', j.jobid IS NOT NULL, j.schedule, j.command
  FROM (SELECT 1) one LEFT JOIN cron.job j ON j.jobname = 'purge-cron-history'
ON CONFLICT (jobname) DO UPDATE SET existed = EXCLUDED.existed, schedule = EXCLUDED.schedule,
                                    command = EXCLUDED.command, saved_at = now();

CREATE OR REPLACE PROCEDURE public.purge_cron_run_details(_keep interval DEFAULT interval '36 hours',
                                                          _batch integer DEFAULT 5000,
                                                          _max_batches integer DEFAULT 200)
LANGUAGE plpgsql
-- NO "SET search_path" here, deliberately: Postgres refuses COMMIT inside a
-- procedure that carries a SET clause ("invalid transaction termination" —
-- caught by the harness, docs/evidence/d1/P6/p6-transcript.txt). Every name
-- below is schema-qualified instead (cron.job_run_details; now() is pg_catalog),
-- the procedure is SECURITY INVOKER and no API role can EXECUTE it.
AS $proc$
DECLARE
  _n       int;
  _batches int := 0;
  _total   bigint := 0;
BEGIN
  IF _keep < interval '24 hours' OR _keep > interval '48 hours' THEN
    RAISE EXCEPTION 'purge_cron_run_details: _keep % is outside the P6 gate (24–48 hours)', _keep;
  END IF;
  IF _batch < 1 OR _batch > 10000 OR _max_batches < 1 THEN
    RAISE EXCEPTION 'purge_cron_run_details: batch % / max % out of bounds (1–10000 / ≥ 1)', _batch, _max_batches;
  END IF;
  LOOP
    DELETE FROM cron.job_run_details
     WHERE runid IN (SELECT runid FROM cron.job_run_details
                      WHERE end_time < now() - _keep
                      ORDER BY runid
                      LIMIT _batch);
    GET DIAGNOSTICS _n = ROW_COUNT;
    _total := _total + _n;
    _batches := _batches + 1;
    COMMIT;
    EXIT WHEN _n < _batch OR _batches >= _max_batches;
  END LOOP;
  RAISE NOTICE 'purge_cron_run_details: % row(s) in % batch(es), keep %', _total, _batches, _keep;
END;
$proc$;
REVOKE ALL ON PROCEDURE public.purge_cron_run_details(interval, integer, integer) FROM PUBLIC;
REVOKE ALL ON PROCEDURE public.purge_cron_run_details(interval, integer, integer) FROM anon;
REVOKE ALL ON PROCEDURE public.purge_cron_run_details(interval, integer, integer) FROM authenticated;

SELECT cron.schedule('purge-cron-history', '17 * * * *', $cmd$CALL public.purge_cron_run_details();$cmd$);

DO $postconditions$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-history' AND schedule = '17 * * * *'
                   AND command ~* 'call\s+public\.purge_cron_run_details') THEN
    RAISE EXCEPTION 'P6-0004-POST-001: purge-cron-history is not hourly calling purge_cron_run_details'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.purge_cron_run_details(interval, integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_cron_run_details(interval, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P6-0004-POST-002: purge_cron_run_details is callable by an API role' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P6-0004: purge-cron-history runs hourly, 36 h retention, batches of 5,000 with a COMMIT each';
END
$postconditions$;

COMMIT;
