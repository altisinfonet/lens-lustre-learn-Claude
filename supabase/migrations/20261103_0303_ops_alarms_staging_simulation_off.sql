-- ═══════════════════════════════════════════════════════════════════════════
-- 20261103_0303 · Foundation fix U3 · STAGING ONLY · switch the alarm
-- simulation OFF again: staging watches nothing (its default from 0300), and
-- the next tick closes the simulation's alarms (targets no longer configured).
-- Refuses on production. Touches only ops_alarm_settings.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION 'APPLY REFUSED — staging-only (p32.lane = %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END $g$;
UPDATE public.ops_alarm_settings SET uptime_targets = '{}', monitored_workflows = '{}', updated_at = now() WHERE id = 1;
SELECT public.ops_evaluate_alarms(now());
DO $p$ BEGIN
  IF EXISTS (SELECT 1 FROM public.ops_alarms WHERE closed_at IS NULL) THEN
    RAISE EXCEPTION 'OPS-0303: alarms still open after switching the simulation off';
  END IF;
  RAISE NOTICE 'OPS-0303: staging simulation OFF, no open alarms';
END $p$;
COMMIT;
