-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0100 — S2 native exits per app build (staging and production)
-- Writes test rows INSIDE its own transaction and ends in ROLLBACK: nothing it
-- does survives. Raises (fails the dispatch) on any hit. Prints COUNTS and
-- BOOLEANS only — the Actions log is public: no member id, no row data.
-- FAILS before 20261031_0100 (G1: admin_health_daily does not count native
-- exits; G2: an exit row is counted as an app start); PASSES after.
--
-- FIXTURE (the same on both lanes, built here, rolled back): two real
-- non-admin accounts A and B. If the lane has no admin, B is made admin for
-- this transaction only (user_roles row, rolled back). user_roles.role is
-- compared as text: staging holds text, production the app_role enum.
--
--   G0 · lane guard.
--   G1 · static: admin_health_daily is SECURITY DEFINER, STABLE, search_path
--        '', EXECUTE for authenticated and not PUBLIC / anon, and counts
--        app.exit.* rows.
--   G2 · behaviour, as real members with their JWT claims (SET LOCAL ROLE):
--        a. A (android, build probe-s2n) sends 2 app.start, 1 app.exit.crash,
--           1 app.exit.crash_native, 1 app.exit.low_memory, 1 app.exit.anr,
--           1 JS error → all 7 stored by the unchanged record_client_telemetry;
--        b. CROSS-MEMBER: A (not an admin) is refused by admin_health_daily;
--        c. the admin reads admin_health_daily(1): the probe-s2n row has
--           starts 2 (exits are NOT starts), errors 1, crashes 2, oom 1,
--           anr 1, crashes_per_100_starts 150.00, errors_per_100_starts 50.00;
--        d. anon cannot execute admin_health_daily.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  _bad   text := '';
  a      uuid;
  b      uuid;
  adm    uuid;
  n      integer;
  failed boolean;
  j      jsonb;
  row_b  jsonb;
  _made_admin boolean := false;
  ev     jsonb := '[
    {"kind":"session","metric":"app.start","platform":"android","app_build":"probe-s2n"},
    {"kind":"session","metric":"app.start","platform":"android","app_build":"probe-s2n"},
    {"kind":"session","metric":"app.exit.crash","platform":"android","app_build":"probe-s2n"},
    {"kind":"session","metric":"app.exit.crash_native","platform":"android","app_build":"probe-s2n"},
    {"kind":"session","metric":"app.exit.low_memory","platform":"android","app_build":"probe-s2n"},
    {"kind":"session","metric":"app.exit.anr","platform":"android","app_build":"probe-s2n"},
    {"kind":"error","metric":"onerror","platform":"android","app_build":"probe-s2n","route":"/feed","error_name":"TypeError","error_hash":"deadbeef"}]';
BEGIN
  -- G0
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  -- G1 · static
  IF to_regprocedure('public.admin_health_daily(integer)') IS NULL
     OR to_regprocedure('public.record_client_telemetry(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0100 G1: S2 telemetry (20261028_0001) is not applied on this lane';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.admin_health_daily(integer)'::regprocedure) NOT LIKE '%app.exit.low_memory%' THEN
    _bad := _bad || E'\n  G1 admin_health_daily does not count native exits (0100 not applied)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.admin_health_daily(integer)'::regprocedure
                   AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']) THEN
    _bad := _bad || E'\n  G1 admin_health_daily attributes differ';
  END IF;
  IF has_function_privilege('anon', 'public.admin_health_daily(integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_health_daily(integer)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = 'public.admin_health_daily(integer)'::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    _bad := _bad || E'\n  G1 admin_health_daily EXECUTE grants differ';
  END IF;

  -- fixture
  WITH m AS (SELECT u.id FROM auth.users u
              WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role::text = 'admin')
              ORDER BY u.id LIMIT 2)
  SELECT min(id::text)::uuid, max(id::text)::uuid INTO a, b FROM m HAVING count(*) = 2;
  IF a IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G2: fewer than two non-admin accounts on this lane'; END IF;
  SELECT ur.user_id INTO adm FROM public.user_roles ur
   WHERE ur.role::text = 'admin' AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id) LIMIT 1;
  IF adm IS NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (b, 'admin');
    adm := b;
    _made_admin := true;
  END IF;
  DELETE FROM public.client_telemetry_quota WHERE user_id = a AND hour = date_trunc('hour', now());

  -- G2a · as A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  n := public.record_client_telemetry(ev);
  IF n <> 7 THEN _bad := _bad || E'\n  G2a stored ' || n || ' of 7 events'; END IF;
  -- G2b · A is not an admin
  failed := false;
  BEGIN PERFORM public.admin_health_daily(1); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2b a non-admin read admin_health_daily'; END IF;
  RESET ROLE;

  -- G2c · the admin read
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', adm::text, true);
  SET LOCAL ROLE authenticated;
  j := public.admin_health_daily(1);
  RESET ROLE;
  SELECT x INTO row_b FROM jsonb_array_elements(j -> 'builds') x
   WHERE x ->> 'app_build' = 'probe-s2n' AND x ->> 'platform' = 'android' LIMIT 1;
  IF row_b IS NULL THEN
    _bad := _bad || E'\n  G2c no builds row for the probe build';
  ELSE
    IF (row_b ->> 'starts')::int IS DISTINCT FROM 2 THEN _bad := _bad || E'\n  G2c starts = ' || coalesce(row_b ->> 'starts', 'null') || ' (want 2: an exit is not a start)'; END IF;
    IF (row_b ->> 'errors')::int IS DISTINCT FROM 1 THEN _bad := _bad || E'\n  G2c errors = ' || coalesce(row_b ->> 'errors', 'null') || ' (want 1)'; END IF;
    IF (row_b ->> 'crashes')::int IS DISTINCT FROM 2 THEN _bad := _bad || E'\n  G2c crashes = ' || coalesce(row_b ->> 'crashes', 'null') || ' (want 2)'; END IF;
    IF (row_b ->> 'oom')::int IS DISTINCT FROM 1 THEN _bad := _bad || E'\n  G2c oom = ' || coalesce(row_b ->> 'oom', 'null') || ' (want 1)'; END IF;
    IF (row_b ->> 'anr')::int IS DISTINCT FROM 1 THEN _bad := _bad || E'\n  G2c anr = ' || coalesce(row_b ->> 'anr', 'null') || ' (want 1)'; END IF;
    IF (row_b ->> 'crashes_per_100_starts')::numeric IS DISTINCT FROM 150.00 THEN _bad := _bad || E'\n  G2c crashes_per_100_starts = ' || coalesce(row_b ->> 'crashes_per_100_starts', 'null') || ' (want 150.00)'; END IF;
    IF (row_b ->> 'errors_per_100_starts')::numeric IS DISTINCT FROM 50.00 THEN _bad := _bad || E'\n  G2c errors_per_100_starts = ' || coalesce(row_b ->> 'errors_per_100_starts', 'null') || ' (want 50.00)'; END IF;
  END IF;
  IF NOT (j ? 'timings' AND j ? 'builds' AND j ? 'realtime' AND j ? 'uploads') THEN
    _bad := _bad || E'\n  G2c admin_health_daily lacks a section';
  END IF;

  -- G2d · anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  failed := false;
  BEGIN PERFORM public.admin_health_daily(1); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2d anon could execute admin_health_daily'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0100:%', _bad;
  END IF;

  RAISE NOTICE 'PROBE PASS 20261031_0100 (lane %): 7 of 7 events stored; non-admin and anon refused; probe build = 2 starts, 1 JS error, 2 crashes, 1 OOM, 1 ANR, 150.00 crashes / 100 starts; admin fixture %',
    current_setting('p32.lane'),
    CASE WHEN _made_admin THEN 'made for this transaction (lane has no admin)' ELSE 'existing admin' END;
END
$probe$;

ROLLBACK;
