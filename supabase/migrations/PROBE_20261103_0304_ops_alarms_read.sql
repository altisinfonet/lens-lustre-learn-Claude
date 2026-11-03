-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation fix U3 · 0304 · read the alarm machinery. READ ONLY.
-- Prints monitoring state only (public URLs, workflow names, HTTP status,
-- alarm summaries) — no member data. Lane-asserted.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;
\pset pager off
\pset format unaligned
\pset fieldsep '|'
SELECT 'OPS0304_LANE', current_setting('p32.lane'), now();
SELECT 'SETTINGS', lane, destination, array_to_string(uptime_targets, ','), array_to_string(monitored_workflows, ','), dead_man_hours FROM public.ops_alarm_settings;
SELECT 'CRON', jobname, schedule, active FROM cron.job WHERE jobname = 'ops-monitor-tick';
SELECT 'CRONRUN', status, count(*), max(start_time) FROM cron.job_run_details
 WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'ops-monitor-tick') AND start_time > now() - interval '2 hours' GROUP BY status;
SELECT 'CHECK', kind, target, requested_at, resolved_at IS NOT NULL, ok, status_code, left(coalesce(error, ''), 80), detail ->> 'last_success_at'
  FROM public.ops_probe_requests ORDER BY id DESC LIMIT 20;
SELECT 'ALARM', id, alarm_key, CASE WHEN closed_at IS NULL THEN 'OPEN' ELSE 'closed' END, opened_at, closed_at, summary
  FROM public.ops_alarms ORDER BY id DESC LIMIT 20;
SELECT 'OPS0304_DONE', now();
ROLLBACK;
