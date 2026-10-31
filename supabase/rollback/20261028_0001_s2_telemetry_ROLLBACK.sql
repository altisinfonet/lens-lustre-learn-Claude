-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261028_0001 — S2-A client telemetry.
-- Removes exactly what 20261028_0001 created: the purge job, the three
-- functions, the two tables (their rows are telemetry only: no member data
-- beyond the 2-hour rate counter). Refuses if the post-state is not present.
-- The client tolerates the RPC being absent (a failed send is dropped).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb_preconditions$
BEGIN
  IF to_regclass('public.client_telemetry') IS NULL
     OR to_regclass('public.client_telemetry_quota') IS NULL
     OR to_regprocedure('public.record_client_telemetry(jsonb)') IS NULL
     OR to_regprocedure('public.admin_health_daily(integer)') IS NULL
     OR to_regprocedure('public.purge_client_telemetry(integer)') IS NULL THEN
    RAISE EXCEPTION 'S2-0001-RB-PRE-001: 20261028_0001''s objects are not all present — nothing to roll back, or it was changed by hand'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-client-telemetry';

DROP FUNCTION public.purge_client_telemetry(integer);
DROP FUNCTION public.admin_health_daily(integer);
DROP FUNCTION public.record_client_telemetry(jsonb);
DROP TABLE public.client_telemetry_quota;
DROP TABLE public.client_telemetry;

DO $rb_postconditions$
BEGIN
  IF to_regclass('public.client_telemetry') IS NOT NULL
     OR to_regclass('public.client_telemetry_quota') IS NOT NULL
     OR to_regproc('public.record_client_telemetry') IS NOT NULL
     OR to_regproc('public.admin_health_daily') IS NOT NULL
     OR to_regproc('public.purge_client_telemetry') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-client-telemetry') THEN
    RAISE EXCEPTION 'S2-0001-RB-POST: an S2 telemetry object is still present' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S2-0001 ROLLBACK: client_telemetry, client_telemetry_quota, record_client_telemetry, admin_health_daily, purge_client_telemetry and the purge job removed';
END
$rb_postconditions$;

COMMIT;
