-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261028_0001 — S2-A client telemetry (staging and production)
-- Writes test rows INSIDE its own transaction and ends in ROLLBACK: nothing it
-- does survives. Raises (fails the dispatch) on any hit. Prints COUNTS and
-- BOOLEANS only — the Actions log is public: no member id, no row data.
-- FAILS before 20261028_0001 (G1: the objects do not exist); PASSES after.
--
--   G0 · lane guard: p32.lane must be staging or production.
--   G1 · static: both tables exist with RLS on and NO policy; anon and
--        authenticated hold no table privilege; record_client_telemetry and
--        admin_health_daily are SECURITY DEFINER, search_path '', executable
--        by authenticated and NOT by PUBLIC / anon; purge_client_telemetry is
--        not executable by any client role; the purge job is scheduled.
--   G2 · behaviour, as real members with their JWT claims (SET LOCAL ROLE):
--        a. A sends 4 valid events (timing / error / realtime / session) and
--           4 invalid ones (free-text route, free-text error hash, negative
--           duration, unknown kind) → exactly 4 stored, none of the invalid;
--        b. a payload that cannot be typed ("ok": "maybe") → 0, no error;
--        c. A cannot SELECT the ledger or the quota (no privilege);
--        d. CROSS-MEMBER: B cannot read A's rows — B's SELECT on the ledger
--           and the quota is refused, and B (not an admin) is refused by
--           admin_health_daily;
--        e. anon cannot execute record_client_telemetry;
--        f. a deleted account (valid JWT, no auth.users row) stores 0;
--        g. B sends 60 valid events in one call → at most 50 stored;
--        h. A at 599 of 600 this hour sends 5 → 1 stored; again → 0;
--        i. an admin (if one exists on the lane) reads admin_health_daily(1):
--           it has timings/builds/realtime/uploads and the probe metric's p95.
--   G3 · the purge runs.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  r       record;
  _bad    text := '';
  a       uuid;
  b       uuid;
  adm     uuid;
  ghost   uuid := gen_random_uuid();
  n       integer;
  n2      integer;
  failed  boolean;
  j       jsonb;
  _admin_tested boolean := false;
  ok_ev   jsonb := '[
    {"kind":"timing","metric":"probe.s2","ok":true,"duration_ms":123.4,"platform":"web","app_build":"probe-s2","route":"/post/:x"},
    {"kind":"error","metric":"onerror","platform":"android","app_build":"probe-s2","route":"/feed","error_name":"TypeError","error_hash":"deadbeef"},
    {"kind":"realtime","metric":"realtime.timed_out","platform":"web","app_build":"probe-s2","route":"/"},
    {"kind":"session","metric":"app.start","platform":"ios","app_build":"probe-s2"}]';
  bad_ev  jsonb := '[
    {"kind":"timing","metric":"probe.s2","ok":true,"duration_ms":5,"platform":"web","app_build":"probe-s2","route":"/post/someone@example.com"},
    {"kind":"error","metric":"onerror","platform":"web","app_build":"probe-s2","error_name":"TypeError","error_hash":"Cannot read x of member"},
    {"kind":"timing","metric":"probe.s2","ok":true,"duration_ms":-1,"platform":"web","app_build":"probe-s2"},
    {"kind":"debug","metric":"probe.s2","platform":"web","app_build":"probe-s2"}]';
  many    jsonb;
BEGIN
  -- G0
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  -- G1 · static
  IF to_regclass('public.client_telemetry') IS NULL OR to_regclass('public.client_telemetry_quota') IS NULL
     OR to_regprocedure('public.record_client_telemetry(jsonb)') IS NULL
     OR to_regprocedure('public.admin_health_daily(integer)') IS NULL
     OR to_regprocedure('public.purge_client_telemetry(integer)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261028_0001 G1: the S2 telemetry objects do not exist on this lane (not applied)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_telemetry'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_telemetry_quota'::regclass) THEN
    _bad := _bad || E'\n  G1 RLS not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('client_telemetry', 'client_telemetry_quota')) THEN
    _bad := _bad || E'\n  G1 a policy exists on a telemetry table';
  END IF;
  FOR r IN SELECT t, p FROM unnest(ARRAY['client_telemetry', 'client_telemetry_quota']) t,
                            unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p LOOP
    IF has_table_privilege('anon', 'public.' || r.t, r.p) OR has_table_privilege('authenticated', 'public.' || r.t, r.p) THEN
      _bad := _bad || E'\n  G1 a client role holds ' || r.p || ' on ' || r.t;
    END IF;
  END LOOP;
  FOR r IN SELECT f, definer, auth_ok FROM (VALUES
      ('public.record_client_telemetry(jsonb)', true, true),
      ('public.admin_health_daily(integer)', true, true),
      ('public.purge_client_telemetry(integer)', false, false)) v(f, definer, auth_ok) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = r.f::regprocedure AND p.prosecdef = r.definer
                     AND p.proconfig = ARRAY['search_path=""']) THEN
      _bad := _bad || E'\n  G1 ' || r.f || ' attributes differ';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.auth_ok
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = r.f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  G1 ' || r.f || ' EXECUTE grants differ';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-client-telemetry') THEN
    _bad := _bad || E'\n  G1 purge job missing';
  END IF;

  -- G2 · two real non-admin members, and an admin if the lane has one.
  WITH m AS (SELECT u.id FROM auth.users u
              WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role = 'admin')
              ORDER BY u.id LIMIT 2)
  SELECT min(id::text)::uuid, max(id::text)::uuid INTO a, b FROM m HAVING count(*) = 2;
  IF a IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G2: fewer than two non-admin accounts on this lane'; END IF;
  SELECT ur.user_id INTO adm FROM public.user_roles ur
   WHERE ur.role = 'admin' AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id) LIMIT 1;
  -- Room for the test on this hour's counters (real accounts; all rolled back).
  DELETE FROM public.client_telemetry_quota WHERE user_id IN (a, b) AND hour = date_trunc('hour', now());

  -- as A: a, b, c
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  n := public.record_client_telemetry(ok_ev || bad_ev);
  IF n <> 4 THEN _bad := _bad || E'\n  G2a stored ' || n || ' of 8 (want exactly the 4 valid)'; END IF;
  n2 := public.record_client_telemetry('[{"kind":"timing","metric":"probe.s2","ok":"maybe","duration_ms":1,"platform":"web","app_build":"probe-s2"}]'::jsonb);
  IF n2 <> 0 THEN _bad := _bad || E'\n  G2b an untypable payload stored rows'; END IF;
  failed := false;
  BEGIN PERFORM count(*) FROM public.client_telemetry; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2c a member could SELECT the ledger'; END IF;
  failed := false;
  BEGIN PERFORM count(*) FROM public.client_telemetry_quota; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2c a member could SELECT the quota'; END IF;
  RESET ROLE;

  -- what A actually stored (this transaction's rows share now())
  SELECT count(*) INTO n FROM public.client_telemetry WHERE created_at = now() AND app_build = 'probe-s2';
  IF n <> 4 THEN _bad := _bad || E'\n  G2a ledger holds ' || n || ' probe rows (want 4)'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_telemetry WHERE created_at = now() AND app_build = 'probe-s2'
              AND (route LIKE '%@%' OR error_hash !~ '^[0-9a-f]+$' OR kind = 'debug')) THEN
    _bad := _bad || E'\n  G2a an invalid row was stored';
  END IF;

  -- as B: d (cross-member), g
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN PERFORM count(*) FROM public.client_telemetry; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2d B could read the ledger (A''s rows)'; END IF;
  failed := false;
  BEGIN PERFORM count(*) FROM public.client_telemetry_quota WHERE user_id = a; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2d B could read A''s quota row'; END IF;
  failed := false;
  BEGIN PERFORM public.admin_health_daily(1); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2d a non-admin read admin_health_daily'; END IF;
  SELECT jsonb_agg(ok_ev -> 0) INTO many FROM generate_series(1, 60);
  n := public.record_client_telemetry(many);
  IF n > 50 OR n < 1 THEN _bad := _bad || E'\n  G2g one call stored ' || n || ' (want 1…50)'; END IF;
  RESET ROLE;

  -- e · anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  failed := false;
  BEGIN PERFORM public.record_client_telemetry(ok_ev); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G2e anon could execute record_client_telemetry'; END IF;
  RESET ROLE;

  -- f · deleted account
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ghost, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ghost::text, true);
  SET LOCAL ROLE authenticated;
  n := public.record_client_telemetry(ok_ev);
  IF n <> 0 THEN _bad := _bad || E'\n  G2f a deleted account stored ' || n; END IF;
  RESET ROLE;

  -- h · A at 599 of 600
  UPDATE public.client_telemetry_quota SET n = 599 WHERE user_id = a AND hour = date_trunc('hour', now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  n := public.record_client_telemetry(ok_ev || jsonb_build_array(ok_ev -> 0));
  n2 := public.record_client_telemetry(ok_ev);
  IF n <> 1 OR n2 <> 0 THEN _bad := _bad || E'\n  G2h rate bound: stored ' || n || ' then ' || n2 || ' (want 1 then 0)'; END IF;
  RESET ROLE;

  -- i · admin read
  IF adm IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', adm::text, true);
    SET LOCAL ROLE authenticated;
    j := public.admin_health_daily(1);
    RESET ROLE;
    _admin_tested := true;
    IF NOT (j ? 'timings' AND j ? 'builds' AND j ? 'realtime' AND j ? 'uploads') THEN
      _bad := _bad || E'\n  G2i admin_health_daily lacks a section';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j -> 'timings') t
                    WHERE t ->> 'metric' = 'probe.s2' AND (t ->> 'p95') IS NOT NULL) THEN
      _bad := _bad || E'\n  G2i admin_health_daily has no p95 for the probe metric';
    END IF;
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- G3
  PERFORM public.purge_client_telemetry(1);

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261028_0001:%', _bad;
  END IF;

  RAISE NOTICE 'PROBE PASS 20261028_0001 (lane %): RLS on, no policy, no client table privilege; anon refused; member B refused on ledger, on A''s quota and on the admin read; 4 of 8 events stored (4 invalid dropped); untypable payload → 0; deleted account → 0; 60 in one call → ≤ 50; rate bound 599/600 → 1 then 0; admin read %. Ledger rows last 24 h (before this probe): %; size %',
    current_setting('p32.lane'),
    CASE WHEN _admin_tested THEN 'PASS' ELSE 'not tested (no admin on this lane)' END,
    (SELECT count(*) FROM public.client_telemetry WHERE created_at > now() - interval '24 hours' AND created_at <> now()),
    pg_size_pretty(pg_total_relation_size('public.client_telemetry'));
END
$probe$;

ROLLBACK;
