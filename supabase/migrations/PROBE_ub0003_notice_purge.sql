-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · UB-0003 (20261005_0002) — the LIVE half. READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   U1 · cron job 'purge-user-block-notices' exists, hourly ('23 * * * *'),
--        command exactly "SELECT public.purge_user_block_notices();".
--   U2 · the purge refuses a keep window under 24 h (called with 23 h inside
--        this read-only transaction: it must raise before any DELETE).
--   U3 · no API role can execute it.
--   U4 · the ledger holds no row older than 26 h (24 h + the hourly cadence +
--        one hour of slack for a late run).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits  text := '';
  _old  bigint;
  _left bigint;
  _last text;
BEGIN
  IF to_regprocedure('public.purge_user_block_notices(interval,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL UB-0003: U1 purge_user_block_notices() is not installed';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'purge-user-block-notices' AND schedule = '23 * * * *'
        AND command = 'SELECT public.purge_user_block_notices();' AND active) <> 1 THEN
    hits := hits || E'\n  U1 the hourly purge job is missing, inactive or changed';
  END IF;
  BEGIN
    PERFORM public.purge_user_block_notices(interval '23 hours');
    hits := hits || E'\n  U2 the purge accepted a 23 h keep window (would re-open the notice cap)';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF has_function_privilege('anon', 'public.purge_user_block_notices(interval,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_user_block_notices(interval,integer,integer)', 'EXECUTE') THEN
    hits := hits || E'\n  U3 an API role can execute the purge';
  END IF;
  SELECT count(*) INTO _old FROM public.user_block_notices WHERE notified_at < now() - interval '26 hours';
  IF _old > 0 THEN
    hits := hits || E'\n  U4 ' || _old || ' ledger row(s) older than 26 h';
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL UB-0003:%', hits;
  END IF;
  SELECT count(*) INTO _left FROM public.user_block_notices;
  SELECT d.start_time::text || ' ' || d.status INTO _last
    FROM cron.job_run_details d
   WHERE d.jobid = (SELECT jobid FROM cron.job WHERE jobname = 'purge-user-block-notices')
   ORDER BY d.start_time DESC LIMIT 1;
  RAISE NOTICE 'PROBE PASS UB-0003: hourly purge at 24 h; ledger % row(s), none older than 26 h; last run %', _left, coalesce(_last, 'never');
END
$probe$;
ROLLBACK;
