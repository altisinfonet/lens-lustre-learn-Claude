-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0043_p32_default_privilege_recurrence.sql
-- Identical stem, as required. STAGING ONLY (R-9).
--
-- ⚠ IT DOES NOT RESTORE THE PRE-STATE, AND IT IS NOT MEANT TO.
--
-- The state 0043 replaced was: the built-in global default in force, which
-- grants **PUBLIC EXECUTE on every newly created function**. Restoring that
-- literally would mean writing
--
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
--
-- and an executable `... TO PUBLIC` is refused under F-62 and R-11. Eleven
-- rollback files in this repository carried exactly that shape and had to be
-- neutralised (Units A, B and C); this file is not going to add a twelfth.
--
-- So this rollback restores the global entry BY GRANTEE NAME, to the two roles
-- the application actually uses:
--
--     GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role
--
-- **The result is access-NARROWER than the pre-state, deliberately.** A new
-- function created after this rollback is executable by `authenticated` and
-- `service_role` and NOT by `anon`, where before 0043 it would have been
-- executable by everyone. If the intent is genuinely to put PUBLIC back, that
-- is an Owner decision and a new forward migration, not a rollback.
--
-- What it does NOT touch:
--   * the `extensions` carve-out. That entry grants PUBLIC EXECUTE for
--     extension functions, and removing it would break the next
--     CREATE EXTENSION — an outage caused by undoing a safety change. It stays
--     whichever direction this file runs.
--   * the postgres/public entry. 0043's first statement only removed a named
--     anon grant that 0037 removes as well; re-granting it here would fight
--     0037 on the production lane, and this file never reaches that lane.
--   * any existing function's ACL anywhere. Default privileges apply only at
--     CREATE time.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ─────────────────────────────
-- The precondition requires 0043's post-state: a global FUNCTION entry with no
-- PUBLIC item. Run before 0043 it refuses, so "it did nothing" and "it did its
-- job" are never the same outcome.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. STAGING ONLY. ─────────────
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback widens the default privileges on newly created functions. '
      'The file cannot detect its own lane, so it refuses unless the lane is '
      'asserted. Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — 0043's post-state must be in place. ───────────────────
DO $preconditions$
BEGIN
  PERFORM 1 FROM pg_default_acl d
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P32-0043-RB-PRE-001: there is no global FUNCTION default-privilege entry for '
      'postgres, so 0043 is not in effect and there is nothing for this file to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0
     AND d.defaclobjtype = 'f' AND x.grantee = 0;
  IF FOUND THEN
    RAISE EXCEPTION
      'P32-0043-RB-PRE-002: the global FUNCTION default already grants PUBLIC, so '
      '0043 is not in effect and there is nothing for this file to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- And it must not already have run. Without this check a second run succeeds
  -- silently: both checks above still hold afterwards, because the grant this
  -- file adds is a NAMED one and neither of them looks at names. "It did
  -- nothing" and "it did its job" would then be the same outcome, which is the
  -- standing rule this precondition exists to keep.
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0
     AND d.defaclobjtype = 'f' AND x.grantee = 'authenticated'::regrole;
  IF FOUND THEN
    RAISE EXCEPTION
      'P32-0043-RB-PRE-003: the global FUNCTION default already grants authenticated '
      'by name, so this rollback has already run and there is nothing left to undo'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE RESTORATION — by grantee NAME. Never TO PUBLIC. ──────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- ── POSTCONDITION ────────────────────────────────────────────────────────
DO $postconditions$
DECLARE o oid; acl text; a boolean; au boolean; sr boolean;
BEGIN
  -- the global entry must still carry no PUBLIC item. This is the assertion
  -- that makes "restored by name" a fact rather than a sentence in the header.
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0
     AND d.defaclobjtype = 'f' AND x.grantee = 0;
  IF FOUND THEN
    RAISE EXCEPTION
      'P32-0043-RB-POST-001: the global FUNCTION default acquired a PUBLIC item. '
      'This file restores by grantee name and must never grant to PUBLIC (F-62, R-11)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- the carve-out survives, in both directions.
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'extensions'::regnamespace
     AND d.defaclobjtype = 'f' AND x.grantee = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P32-0043-RB-POST-002: the extensions carve-out was removed. Rolling back the '
      'recurrence control must not break the next CREATE EXTENSION'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- and the merged result, measured the same way 0043 measures it.
  EXECUTE 'CREATE FUNCTION public._p32r_probe() RETURNS void LANGUAGE sql '
          'SECURITY DEFINER SET search_path = '''' AS $probe$ SELECT $probe$';
  SELECT p.oid INTO o FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_p32r_probe';
  acl := coalesce((SELECT proacl::text FROM pg_proc WHERE oid = o), '(null: built-in default)');
  a   := has_function_privilege('anon', o, 'EXECUTE');
  au  := has_function_privilege('authenticated', o, 'EXECUTE');
  sr  := has_function_privilege('service_role', o, 'EXECUTE');
  EXECUTE 'DROP FUNCTION public._p32r_probe()';

  IF NOT au OR NOT sr THEN
    RAISE EXCEPTION
      'P32-0043-RB-POST-003: a newly created function in public is not executable by '
      'authenticated and service_role. acl=%', acl
      USING ERRCODE = 'raise_exception';
  END IF;
  IF a THEN
    RAISE EXCEPTION
      'P32-0043-RB-POST-004: anon can execute a newly created function. This rollback '
      'restores by name and is deliberately NARROWER than the pre-state; anon coming '
      'back means a PUBLIC grant was re-created somewhere. acl=%', acl
      USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE
    'P32-0043 rolled back: new functions are %, authenticated=true, service_role=true, '
    'anon=false — narrower than the pre-state, by design', acl;
END
$postconditions$;

COMMIT;
