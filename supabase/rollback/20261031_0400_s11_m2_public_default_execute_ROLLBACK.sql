-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0400 — S11 M2.
-- Restores the measured pre-0400 default: functions `postgres` creates in
-- `public` are born executable by `authenticated` again. Changes no existing
-- function's ACL (functions created while 0400 was applied keep whatever
-- their migration granted). Refuses unless 0400 is applied.
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

DO $rb_pre$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S11-M2-RB-PRE-001: running as %, not postgres', current_user;
  END IF;
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype = 'f' AND x.privilege_type = 'EXECUTE' AND x.grantee = 'authenticated'::regrole;
  IF FOUND THEN
    RAISE EXCEPTION 'S11-M2-RB-PRE-002: 20261031_0400 is not applied on this lane (authenticated already holds the default) — nothing to roll back';
  END IF;
END
$rb_pre$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;

DO $rb_post$
BEGIN
  CREATE FUNCTION public._s11_m2_rb_check() RETURNS integer LANGUAGE sql AS 'SELECT 1';
  IF NOT has_function_privilege('authenticated', 'public._s11_m2_rb_check()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S11-M2-RB-POST-001: a new public function is still not executable by authenticated';
  END IF;
  IF has_function_privilege('anon', 'public._s11_m2_rb_check()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S11-M2-RB-POST-002: anon can execute a new public function — 0043 must stay in force';
  END IF;
  DROP FUNCTION public._s11_m2_rb_check();
  RAISE NOTICE 'S11 M2 rolled back (lane %): new public functions are born executable by authenticated', current_setting('p32.lane');
END
$rb_post$;

COMMIT;
