-- ROLLBACK for 20261103_0300_ops_alarms.sql — removes the in-database alarms.
-- Drops ONLY objects that migration created (ops_* tables, functions, the
-- ops-monitor-tick cron job). Alarm history in ops_alarms is lost; that data is
-- monitoring state, not member data.
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted' USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $c$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-monitor-tick') THEN
    PERFORM cron.unschedule('ops-monitor-tick');
  END IF;
END $c$;

DROP FUNCTION IF EXISTS public.ops_monitor_tick();
DROP FUNCTION IF EXISTS public.ops_evaluate_alarms(timestamptz);
DROP FUNCTION IF EXISTS public.ops_alarm_set(text, boolean, text, jsonb);
DROP TABLE IF EXISTS public.ops_alarms;
DROP TABLE IF EXISTS public.ops_probe_requests;
DROP TABLE IF EXISTS public.ops_alarm_settings;

DO $post$ BEGIN
  IF to_regclass('public.ops_alarms') IS NOT NULL OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-monitor-tick') THEN
    RAISE EXCEPTION 'OPS-0300-ROLLBACK-POST: objects remain';
  END IF;
END $post$;

COMMIT;
