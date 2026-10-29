-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0100 — S2 native exits.
-- Restores admin_health_daily exactly as 20261028_0001 created it (counts
-- every 'session' row as a start; no crash / OOM / ANR columns). The admin
-- page tolerates both shapes. Exit rows already stored stay in the ledger
-- (30-day purge) and would count as starts again, as before 0100.
-- Refuses unless 0100 is applied.
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
  IF to_regprocedure('public.admin_health_daily(integer)') IS NULL
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_health_daily(integer)'::regprocedure) NOT LIKE '%app.exit.%' THEN
    RAISE EXCEPTION 'S2-0100-RB-PRE: 20261031_0100 is not applied on this lane — nothing to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

CREATE OR REPLACE FUNCTION public.admin_health_daily(_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _uid  uuid := (SELECT auth.uid());
  _d    integer := GREATEST(1, LEAST(coalesce(_days, 7), 30));
  _from timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(days => _d - 1);
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'S2HEALTH-001: only an admin can read app health' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'days', _d,
    'timings', coalesce((
      SELECT jsonb_agg(t ORDER BY t.day DESC, t.metric) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, c.metric, count(*) AS n,
               round(percentile_cont(0.50) WITHIN GROUP (ORDER BY c.duration_ms))::integer AS p50,
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY c.duration_ms))::integer AS p95,
               round(percentile_cont(0.99) WITHIN GROUP (ORDER BY c.duration_ms))::integer AS p99,
               round(100.0 * count(*) FILTER (WHERE NOT c.ok) / count(*), 2) AS fail_pct
          FROM public.client_telemetry c
         WHERE c.kind = 'timing' AND c.created_at >= _from
         GROUP BY 1, 2) t), '[]'::jsonb),
    'builds', coalesce((
      SELECT jsonb_agg(b ORDER BY b.day DESC, b.starts DESC) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, c.platform, c.app_build,
               count(*) FILTER (WHERE c.kind = 'session') AS starts,
               count(*) FILTER (WHERE c.kind = 'error') AS errors,
               CASE WHEN count(*) FILTER (WHERE c.kind = 'session') = 0 THEN NULL
                    ELSE round(100.0 * count(*) FILTER (WHERE c.kind = 'error')
                               / count(*) FILTER (WHERE c.kind = 'session'), 2) END AS errors_per_100_starts
          FROM public.client_telemetry c
         WHERE c.kind IN ('session', 'error') AND c.created_at >= _from
         GROUP BY 1, 2, 3) b), '[]'::jsonb),
    'realtime', coalesce((
      SELECT jsonb_agg(r ORDER BY r.day DESC) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS attempts,
               count(*) FILTER (WHERE c.metric <> 'realtime.subscribed') AS failures,
               round(100.0 * count(*) FILTER (WHERE c.metric <> 'realtime.subscribed') / count(*), 2) AS fail_pct
          FROM public.client_telemetry c
         WHERE c.kind = 'realtime' AND c.created_at >= _from
         GROUP BY 1) r), '[]'::jsonb),
    'uploads', coalesce((
      SELECT jsonb_agg(u ORDER BY u.day DESC) FROM (
        SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS attempts,
               count(*) FILTER (WHERE NOT c.ok) AS failures,
               round(100.0 * count(*) FILTER (WHERE NOT c.ok) / count(*), 2) AS fail_pct
          FROM public.client_telemetry c
         WHERE c.kind = 'timing' AND c.metric IN ('upload.photo', 'upload.video') AND c.created_at >= _from
         GROUP BY 1) u), '[]'::jsonb)
  );
END;
$fn$;

DO $rb_postconditions$
DECLARE
  _bad text := '';
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_health_daily(integer)'::regprocedure) LIKE '%app.exit.%' THEN
    _bad := _bad || E'\n  admin_health_daily still counts native exits';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.admin_health_daily(integer)'::regprocedure
                   AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']) THEN
    _bad := _bad || E'\n  admin_health_daily attributes differ (want SECURITY DEFINER, STABLE, empty search_path)';
  END IF;
  IF has_function_privilege('anon', 'public.admin_health_daily(integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_health_daily(integer)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = 'public.admin_health_daily(integer)'::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    _bad := _bad || E'\n  admin_health_daily EXECUTE grants differ (want authenticated yes; PUBLIC and anon no)';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S2-0100-RB-POST:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S2-0100 ROLLBACK: admin_health_daily restored to the 20261028_0001 body; grants unchanged';
END
$rb_postconditions$;

COMMIT;
