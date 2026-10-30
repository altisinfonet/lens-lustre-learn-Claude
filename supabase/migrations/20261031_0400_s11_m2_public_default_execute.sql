-- ═══════════════════════════════════════════════════════════════════════════
-- S11 · M2 — a NEW function in `public` is no longer born executable by
-- `authenticated`. Both lanes.
--
-- MEASURED (PROBE_s11_m2_default_privileges, staging 40984184794, production
-- 40987139679, 2026-10-30): for functions created by `postgres`
--     (all schemas)  EXECUTE to PUBLIC=f anon=f authenticated=f   (0043)
--     public         EXECUTE to PUBLIC=f anon=f authenticated=t   <- this file
-- so every function a migration creates in `public` is callable by every
-- signed-in member unless that migration remembers a REVOKE. anon/PUBLIC were
-- closed in September (20260910_0043); `authenticated` is what is left.
--
-- WHAT THIS CHANGES: one ALTER DEFAULT PRIVILEGES. Default privileges apply
-- only when a function is CREATED (or DROPPED and created again — F-66;
-- CREATE OR REPLACE keeps the existing ACL). NO EXISTING FUNCTION'S ACL CHANGES,
-- so no current caller loses anything; the postcondition counts it.
--
-- THE ALLOW-LIST: from now on a migration that creates a function members call
-- must GRANT it explicitly. src/__tests__/m2FunctionCallersExplicit.test.ts
-- fails CI for any new migration or rollback file that creates a non-trigger
-- function in `public` without a GRANT or REVOKE naming it.
--
-- NOT CHANGED (and why): defaults granted by `supabase_admin` (graphql,
-- graphql_public) and postgres's `storage` default are Supabase platform
-- schemas this app does not create functions in; `postgres` cannot alter
-- supabase_admin's defaults. service_role keeps its default (edge functions).
--
-- PROBE:    supabase/migrations/PROBE_20261031_0400_s11_m2_public_default_execute.sql
-- Rollback: supabase/rollback/20261031_0400_s11_m2_public_default_execute_ROLLBACK.sql
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

-- Snapshot of every public function's effective EXECUTE for the three API roles.
CREATE TEMP TABLE _m2_before ON COMMIT DROP AS
SELECT p.oid,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_x,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc_x
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace;

DO $pre$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S11-M2-PRE-001: running as %, not postgres — functions this lane''s migrations create are owned by postgres, so the default below must be measured as postgres', current_user;
  END IF;
  -- 0043 must be in place: the global postgres entry exists and grants no PUBLIC.
  PERFORM 1 FROM pg_default_acl d
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'S11-M2-PRE-002: 20260910_0043 is not applied (no global function default for postgres) — PUBLIC would still hand EXECUTE to authenticated';
  END IF;
END
$pre$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

DO $post$
DECLARE
  n integer;
BEGIN
  -- 1 · the public default grants EXECUTE to none of PUBLIC / anon / authenticated.
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype = 'f' AND x.privilege_type = 'EXECUTE'
     AND (x.grantee = 0 OR x.grantee IN ('anon'::regrole, 'authenticated'::regrole));
  IF FOUND THEN
    RAISE EXCEPTION 'S11-M2-POST-001: the public function default still grants EXECUTE to PUBLIC, anon or authenticated';
  END IF;

  -- 2 · behaviour: a function created now is not executable by anon or
  --     authenticated, and still is by service_role (dropped again below).
  CREATE FUNCTION public._s11_m2_born_closed() RETURNS integer LANGUAGE sql AS 'SELECT 1';
  IF has_function_privilege('authenticated', 'public._s11_m2_born_closed()', 'EXECUTE')
     OR has_function_privilege('anon', 'public._s11_m2_born_closed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S11-M2-POST-002: a new public function is still executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public._s11_m2_born_closed()', 'EXECUTE')
     AND EXISTS (SELECT 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
                  WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
                    AND d.defaclobjtype = 'f' AND x.grantee = 'service_role'::regrole) THEN
    RAISE EXCEPTION 'S11-M2-POST-003: service_role lost EXECUTE on new functions';
  END IF;
  DROP FUNCTION public._s11_m2_born_closed();

  -- 3 · no existing function's effective EXECUTE changed for any API role.
  SELECT count(*) INTO n
    FROM _m2_before b
   WHERE has_function_privilege('anon', b.oid, 'EXECUTE')          IS DISTINCT FROM b.anon_x
      OR has_function_privilege('authenticated', b.oid, 'EXECUTE') IS DISTINCT FROM b.auth_x
      OR has_function_privilege('service_role', b.oid, 'EXECUTE')  IS DISTINCT FROM b.svc_x;
  IF n <> 0 THEN
    RAISE EXCEPTION 'S11-M2-POST-004: % existing public functions changed EXECUTE — this file must change only the default', n;
  END IF;

  RAISE NOTICE 'S11 M2 applied (lane %): public default closed for authenticated; % existing functions unchanged',
    current_setting('p32.lane'), (SELECT count(*) FROM _m2_before);
END
$post$;

COMMIT;
