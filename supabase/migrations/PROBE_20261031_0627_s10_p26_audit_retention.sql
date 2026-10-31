-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0627 · S10 P26 retention (stated window: 180 days).
-- READ ONLY, ROLLBACK. FAIL before the apply, PASS after:
--   G1  schema p26_archive and p26_archive.db_audit_logs exist; no API role
--       has USAGE on the schema
--   G2  cron job p26-audit-retention runs daily and calls the procedure;
--       the procedure exists and no API role can run it
--   G3  no row in public.db_audit_logs is older than 181 days (window + one
--       daily run)
-- Prints counts and dates only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $probe$
DECLARE n bigint; a bigint; oldest timestamptz;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  IF to_regclass('p26_archive.db_audit_logs') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 0627 G1: p26_archive.db_audit_logs missing';
  END IF;
  IF has_schema_privilege('anon', 'p26_archive', 'USAGE') OR has_schema_privilege('authenticated', 'p26_archive', 'USAGE')
     OR has_schema_privilege('service_role', 'p26_archive', 'USAGE') THEN
    RAISE EXCEPTION 'PROBE FAIL 0627 G1: an API role can use schema p26_archive';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN RAISE EXCEPTION 'PROBE FAIL 0627 G2: pg_cron missing'; END IF;
  EXECUTE $q$SELECT count(*) FROM cron.job WHERE jobname = 'p26-audit-retention' AND active AND schedule = '23 4 * * *'
             AND command ~* 'call\s+public\.p26_move_old_audit_rows\(\)'$q$ INTO n;
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL 0627 G2: daily cron job p26-audit-retention not found'; END IF;
  IF to_regprocedure('public.p26_move_old_audit_rows(interval,integer,integer)') IS NULL
     OR has_function_privilege('anon', 'public.p26_move_old_audit_rows(interval,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.p26_move_old_audit_rows(interval,integer,integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.p26_move_old_audit_rows(interval,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL 0627 G2: procedure missing or runnable by an API role';
  END IF;
  SELECT count(*), min(created_at) INTO n, oldest FROM public.db_audit_logs WHERE created_at < now() - interval '181 days';
  IF n > 0 THEN RAISE EXCEPTION 'PROBE FAIL 0627 G3: % live audit row(s) older than 181 days (oldest %)', n, date_trunc('day', oldest); END IF;
  SELECT count(*) INTO a FROM p26_archive.db_audit_logs;
  SELECT min(created_at) INTO oldest FROM public.db_audit_logs;
  RAISE NOTICE 'PROBE PASS 0627 — archive private, daily job, 0 live rows past 181 days (archived %, oldest live %)', a, date_trunc('day', oldest);
END
$probe$;

ROLLBACK;
