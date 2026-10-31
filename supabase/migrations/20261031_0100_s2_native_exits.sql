-- ═══════════════════════════════════════════════════════════════════════════
-- 20261031_0100 — S2 native exits: crash / native crash / out-of-memory / ANR
--   per app build, in the Owner's App health page.
--
-- WHY: the S2 gate asks for "crash rate per app build". 20261028_0001 counts
-- only JavaScript errors per app start; a native crash or an out-of-memory
-- kill of the Android app never reaches JavaScript, so it was invisible (the
-- page said so). The Android app now reads the OS's own record of why its
-- earlier processes ended (ApplicationExitInfo, Android 11+, a free OS API)
-- on the next start and sends one telemetry row per bad exit, through the
-- SAME record_client_telemetry RPC, as kind 'session':
--     app.exit.crash         Java crash
--     app.exit.crash_native  native (C/C++) crash
--     app.exit.low_memory    killed for memory while on screen (OOM)
--     app.exit.anr           "app not responding" kill
-- record_client_telemetry already accepts these (metric pattern unchanged),
-- so this file changes ONLY the read: admin_health_daily's 'builds' section.
--
-- WHAT CHANGES (one function body, same signature, same return type):
--   · starts  = only 'app.start' rows (before: every 'session' row — an exit
--               row must not count as a start).
--   · crashes, oom, anr: new counts per day / platform / build.
--   · crashes_per_100_starts = (crashes + oom) per 100 app starts.
--   · errors, errors_per_100_starts: unchanged.
-- CREATE OR REPLACE keeps the grants (no DROP, trap #3); the postconditions
-- re-check them. Nothing else is touched.
-- Rollback: supabase/rollback/20261031_0100_s2_native_exits_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261031_0100_s2_native_exits.sql
-- Lanes: staging and production. S2 range 0100-0199. 2026-10-29.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  IF to_regprocedure('public.admin_health_daily(integer)') IS NULL
     OR to_regclass('public.client_telemetry') IS NULL THEN
    RAISE EXCEPTION 'S2-0100-PRE-001: 20261028_0001 (S2 telemetry) is not applied on this lane'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_health_daily(integer)'::regprocedure) LIKE '%app.exit.%' THEN
    RAISE EXCEPTION 'S2-0100-PRE-002: admin_health_daily already counts native exits — 20261031_0100 is applied'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

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
        SELECT x.day, x.platform, x.app_build, x.starts, x.errors, x.crashes, x.oom, x.anr,
               CASE WHEN x.starts = 0 THEN NULL ELSE round(100.0 * x.errors / x.starts, 2) END AS errors_per_100_starts,
               CASE WHEN x.starts = 0 THEN NULL ELSE round(100.0 * (x.crashes + x.oom) / x.starts, 2) END AS crashes_per_100_starts
          FROM (
            SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, c.platform, c.app_build,
                   count(*) FILTER (WHERE c.kind = 'session' AND c.metric = 'app.start') AS starts,
                   count(*) FILTER (WHERE c.kind = 'error') AS errors,
                   count(*) FILTER (WHERE c.kind = 'session' AND c.metric IN ('app.exit.crash', 'app.exit.crash_native')) AS crashes,
                   count(*) FILTER (WHERE c.kind = 'session' AND c.metric = 'app.exit.low_memory') AS oom,
                   count(*) FILTER (WHERE c.kind = 'session' AND c.metric = 'app.exit.anr') AS anr
              FROM public.client_telemetry c
             WHERE c.kind IN ('session', 'error') AND c.created_at >= _from
             GROUP BY 1, 2, 3) x) b), '[]'::jsonb),
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

DO $postconditions$
DECLARE
  _bad text := '';
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_health_daily(integer)'::regprocedure) NOT LIKE '%app.exit.low_memory%' THEN
    _bad := _bad || E'\n  admin_health_daily does not count native exits';
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
    RAISE EXCEPTION 'S2-0100-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S2-0100: admin_health_daily builds = app starts, JS errors, native crashes, OOM, ANR per build; grants unchanged';
END
$postconditions$;

COMMIT;
