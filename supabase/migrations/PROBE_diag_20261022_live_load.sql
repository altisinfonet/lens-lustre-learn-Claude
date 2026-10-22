-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · DIAGNOSIS 2026-10-22 · why web + app got slow (Owner report).
-- READ ONLY (BEGIN READ ONLY … ROLLBACK). Prints NOTICEs only; changes nothing.
-- Measures, since the S12 applies of 2026-10-18:
--   1. cron runs per job (S12 refresh-feed-scores / purge-feed-signals and all
--      others): runs, failures, avg / max seconds, last 24 h vs all retained
--   2. the 15 statements with the most total database time (pg_stat_statements,
--      constants are already normalised to $n — no member data)
--   3. S12 signal ingest volume per day, and now-active connections
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $diag$
DECLARE r record;
BEGIN
  RAISE NOTICE 'DIAG-LOAD now=%  pg_stat_statements reset=%', now(),
    (SELECT stats_reset FROM pg_stat_statements_info);

  FOR r IN
    SELECT j.jobname, j.schedule,
           count(*) FILTER (WHERE d.start_time > now() - interval '24 hours')                       AS runs24,
           count(*) FILTER (WHERE d.start_time > now() - interval '24 hours' AND d.status <> 'succeeded') AS fail24,
           round(avg(extract(epoch FROM d.end_time - d.start_time)) FILTER (WHERE d.start_time > now() - interval '24 hours')::numeric, 2) AS avg24_s,
           round(max(extract(epoch FROM d.end_time - d.start_time)) FILTER (WHERE d.start_time > now() - interval '24 hours')::numeric, 2) AS max24_s,
           round(sum(extract(epoch FROM d.end_time - d.start_time)) FILTER (WHERE d.start_time > now() - interval '24 hours')::numeric, 0) AS busy24_s
      FROM cron.job j LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid
     GROUP BY j.jobname, j.schedule
     ORDER BY busy24_s DESC NULLS LAST
  LOOP
    RAISE NOTICE 'DIAG-CRON % [%] 24h: runs % fail % avg %s max %s busy %s s',
      r.jobname, r.schedule, r.runs24, r.fail24, r.avg24_s, r.max24_s, r.busy24_s;
  END LOOP;

  FOR r IN
    SELECT round(s.total_exec_time / 1000)::bigint AS total_s, s.calls,
           round(s.mean_exec_time::numeric, 1) AS mean_ms,
           left(regexp_replace(s.query, '\s+', ' ', 'g'), 140) AS q
      FROM pg_stat_statements s
     WHERE s.query !~* '(password|secret|token|apikey|api_key|vault|decrypted|jwt|bearer)'   -- never print a credential (the Actions log is public)
     ORDER BY s.total_exec_time DESC LIMIT 15
  LOOP
    RAISE NOTICE 'DIAG-TOP total % s | calls % | mean % ms | %', r.total_s, r.calls, r.mean_ms, r.q;
  END LOOP;

  FOR r IN
    SELECT date_trunc('day', created_at)::date AS d, count(*) AS n
      FROM public.feed_signal_events
     WHERE created_at > now() - interval '5 days'
     GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'DIAG-SIGNALS % rows %', r.d, r.n;
  END LOOP;

  RAISE NOTICE 'DIAG-CONN active % / total %',
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active'),
    (SELECT count(*) FROM pg_stat_activity);
END
$diag$;
ROLLBACK;
