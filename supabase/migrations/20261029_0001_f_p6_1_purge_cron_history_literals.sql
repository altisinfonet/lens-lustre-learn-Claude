-- S8 / F-P6-1 · purge run-history rows that carry a literal credential.
--
-- cron.job_run_details.command copies each job's full command on every run.
-- Before P9 three jobs carried x-cron-secret / x-scheduled-posts-secret / the
-- anon key as literals, so every run row holds them. P9 (20261004_0006,
-- 20261005_0003, 0007) moved them into the vault; P6 (20261004_0004) keeps 36 h.
-- This file removes the STOCK that is left, once and only if the root is fixed.
--
-- Run only when PROBE_s8_f_p6_1_cron_history_literals.sql shows R1 PASS and
-- H1 FAIL. If R1 FAILS, this file refuses: purging while a job still writes
-- literals just refills the table.
-- Deletes run-log rows only (no object is dropped). Prints a count, never a
-- command. Rollback: supabase/rollback/20261029_0001_f_p6_1_purge_cron_history_literals_ROLLBACK.sql
-- (a deliberate no-op: a deleted log row cannot be restored, and must not be).
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $purge$
DECLARE
  _root int;
  _n    int;
BEGIN
  -- PRE-001 · the root is fixed: no scheduled command holds a 17+ literal
  SELECT count(*) INTO _root
    FROM cron.job j
   WHERE EXISTS (SELECT 1 FROM regexp_matches(j.command, '''((?:[^'']|'''')*)''', 'g') m
                  WHERE length(m[1]) >= 17 AND m[1] IS DISTINCT FROM j.jobname);
  IF _root <> 0 THEN
    RAISE EXCEPTION 'F-P6-1-PRE-001: % cron job(s) still hold a long literal in their command; apply P9 first — refusing', _root
      USING ERRCODE = 'raise_exception';
  END IF;

  DELETE FROM cron.job_run_details d
   WHERE EXISTS (SELECT 1 FROM regexp_matches(d.command, '''((?:[^'']|'''')*)''', 'g') m
                  WHERE length(m[1]) >= 17
                    AND m[1] NOT IN (SELECT jobname FROM cron.job WHERE jobname IS NOT NULL));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'F-P6-1: removed % run-history row(s) holding a long literal', _n;
END
$purge$;

COMMIT;
