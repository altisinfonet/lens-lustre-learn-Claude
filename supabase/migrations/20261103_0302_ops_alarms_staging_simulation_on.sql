-- ═══════════════════════════════════════════════════════════════════════════
-- 20261103_0302 · Foundation fix U3 · STAGING ONLY · switch the alarm
-- SIMULATION on: point staging's monitor at a site that cannot answer
-- (https://down.invalid/ — the .invalid TLD never resolves, RFC 2606) next to
-- the real www, and at a workflow that has never succeeded
-- (d1-deploy-functions.yml: 1 run ever, failed) as a "stopped monitor".
-- Expected within ~10 min: uptime alarm for down.invalid only; dead-man alarm
-- for d1-deploy-functions.yml. Read with PROBE_20261103_0304. Switched off by
-- 20261103_0303. Refuses on production. Touches only ops_alarm_settings.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION 'APPLY REFUSED — staging-only simulation (p32.lane = %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END $g$;
UPDATE public.ops_alarm_settings
   SET uptime_targets = ARRAY['https://down.invalid/', 'https://www.50mmretina.com/'],
       monitored_workflows = ARRAY['d1-deploy-functions.yml'],
       updated_at = now()
 WHERE id = 1;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_alarm_settings WHERE id = 1 AND 'https://down.invalid/' = ANY (uptime_targets)) THEN
    RAISE EXCEPTION 'OPS-0302: settings row missing or not updated';
  END IF;
  RAISE NOTICE 'OPS-0302: staging simulation ON';
END $p$;
COMMIT;
