-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P6 · cron.job_run_details retention — LIVE half. READ-ONLY. Raises on:
--   (a) no active job 'purge-cron-history' hourly calling purge_cron_run_details();
--   (b) any other cron command deleting from cron.job_run_details (unbounded purge);
--   (c) a finished row older than 49 h (36 h retention + 1 h cadence + 12 h slack,
--       still inside the gate's 48 h + the hour between runs);
--   (d) cron.job_run_details among the ten largest relations in the database
--       (pg_total_relation_size over every table and matview, catalogs included).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  oldest interval; rnk int; other text; sz text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-history' AND active
                   AND schedule ~ '^\s*\d+\s+\*\s+\*\s+\*\s+\*\s*$' AND command ~* 'call\s+public\.purge_cron_run_details') THEN
    RAISE EXCEPTION 'PROBE FAIL P6: no active hourly purge-cron-history calling purge_cron_run_details()';
  END IF;
  SELECT string_agg(jobname, ', ') INTO other FROM cron.job
   WHERE jobname <> 'purge-cron-history' AND command ~* 'job_run_details';
  IF other IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P6: other job(s) touch cron.job_run_details (unbounded purge?): %', other;
  END IF;
  SELECT now() - min(end_time) INTO oldest FROM cron.job_run_details WHERE end_time IS NOT NULL;
  IF oldest > interval '49 hours' THEN
    RAISE EXCEPTION 'PROBE FAIL P6: oldest finished run is % old (retention is 36 h; limit 49 h)', date_trunc('minute', oldest);
  END IF;
  SELECT r, pg_size_pretty(s) INTO rnk, sz FROM (
    SELECT c.oid, pg_total_relation_size(c.oid) s, row_number() OVER (ORDER BY pg_total_relation_size(c.oid) DESC) r
      FROM pg_class c WHERE c.relkind IN ('r', 'm')) x
   WHERE x.oid = 'cron.job_run_details'::regclass;
  IF rnk <= 10 THEN
    RAISE EXCEPTION 'PROBE FAIL P6: cron.job_run_details is #% largest relation (% ) — gate: not among the ten largest', rnk, sz;
  END IF;
  RAISE NOTICE 'PROBE PASS P6: hourly bounded purge, oldest run % old, job_run_details is #% (%)', date_trunc('minute', coalesce(oldest, interval '0')), rnk, sz;
END
$probe$;
ROLLBACK;
