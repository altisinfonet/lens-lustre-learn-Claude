-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0400 — S11 M2 (staging and production).
-- Creates one throwaway function INSIDE its own transaction and ends in
-- ROLLBACK: nothing survives. Prints COUNTS and BOOLEANS only (public log).
-- FAILS before 0400 (G1/G2: a new public function is executable by
-- authenticated); PASSES after.
--
-- The fixture is built the same way on both lanes (a function created by
-- `postgres` in `public`, exactly what every migration does), so the lane
-- shapes cannot differ in what is measured.
--
--   G0 · lane asserted; running as postgres.
--   G1 · static: postgres's public function default grants EXECUTE to none of
--        PUBLIC / anon / authenticated.
--   G2 · behaviour: a function created now — anon NO, authenticated NO.
--   G3 · regression: the member feed RPCs that exist on the lane are still
--        executable by authenticated (get_feed_page, get_broadcast_feed,
--        record_client_telemetry) — 0400 must not touch existing ACLs.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  _bad text := '';
  f    text;
  n_ok integer := 0;
BEGIN
  -- G0
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'PROBE REFUSED — running as %, not postgres', current_user;
  END IF;

  -- G1
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype = 'f' AND x.privilege_type = 'EXECUTE'
     AND (x.grantee = 0 OR x.grantee IN ('anon'::regrole, 'authenticated'::regrole));
  IF FOUND THEN _bad := _bad || ' G1(public default grants EXECUTE to PUBLIC/anon/authenticated)'; END IF;

  -- G2
  CREATE FUNCTION public._probe_s11_m2() RETURNS integer LANGUAGE sql AS 'SELECT 1';
  IF has_function_privilege('authenticated', 'public._probe_s11_m2()', 'EXECUTE') THEN
    _bad := _bad || ' G2a(new function executable by authenticated)';
  END IF;
  IF has_function_privilege('anon', 'public._probe_s11_m2()', 'EXECUTE') THEN
    _bad := _bad || ' G2b(new function executable by anon)';
  END IF;

  -- G3
  FOREACH f IN ARRAY ARRAY['get_feed_page', 'get_broadcast_feed', 'record_client_telemetry'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f) THEN
      IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f
                    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
        _bad := _bad || format(' G3(%s lost authenticated EXECUTE)', f);
      ELSE
        n_ok := n_ok + 1;
      END IF;
    END IF;
  END LOOP;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0400 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0400 (lane %): public default closed; new function anon=f authenticated=f; % member RPCs still executable',
    current_setting('p32.lane'), n_ok;
END
$probe$;

ROLLBACK;
