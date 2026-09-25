-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · THE RECURRENCE CONTROL. Both lanes.
--
-- P32 is the finding that anonymous callers can execute SECURITY DEFINER
-- functions in `public`. Units 0034, 0035 and 0037 close the functions that
-- exist. This file closes the door they keep coming through: on both lanes,
-- **every newly created function in `public` is born anon-executable**, so the
-- first migration that forgets an explicit REVOKE reopens P32 by itself.
--
-- Staging holds at four anon-executable functions only because every migration
-- so far has revoked explicitly. That is a discipline, not a control.
--
-- ── WHY 0037's LINE IS NOT ENOUGH — R-51, correction C-A20 ───────────────
--
-- R-50 gave 0037 this, as "the recurrence control":
--
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--       REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
--
-- A per-schema default can only ADD to the global default; it cannot subtract
-- from it (F-65). The global default for functions is still the built-in one,
-- `{=X/postgres, postgres=X/postgres}`, which grants PUBLIC EXECUTE — and anon
-- inherits from PUBLIC. So that statement removes the NAMED anon grant and
-- changes nothing about whether anon can execute.
--
-- Measured on PostgreSQL 17.11, one statement at a time, with a real function
-- created and probed at each step (docs/evidence/d1/phase1/p32-0043-transcript.txt):
--
--     baseline                    anon=TRUE
--     + the per-schema REVOKE     anon=TRUE    <- 0037's line, on its own
--     + the GLOBAL REVOKE         anon=FALSE   <- the statement that closes it
--
-- 0037 is NOT wrong and is not being corrected: its line is necessary, it
-- removes the named anon grant the production reading shows, and this file
-- repeats it idempotently. It was only ever insufficient.
--
-- ── THE `extensions` CARVE-OUT, AND WHY IT IS THE ONE PERMITTED `TO PUBLIC`
--
-- The global REVOKE is global. It also strips PUBLIC EXECUTE from the
-- functions of any extension `postgres` installs or updates afterwards, which
-- would break them for `anon` and `authenticated` alike, at the moment someone
-- runs a routine CREATE EXTENSION or ALTER EXTENSION ... UPDATE. Measured:
-- without the carve-out, pg_trgm's `similarity` comes out `{postgres=X}` and
-- anon cannot execute it; with it, `similarity` comes out exactly as it does
-- today — proacl NULL, the built-in default, anon able to execute.
--
-- So the third statement re-grants PUBLIC EXECUTE **only for functions created
-- in `extensions`**. It is the sanctioned exception R-51 names, and the only
-- `... TO PUBLIC` permitted anywhere in Phase 1. The static scan accepts
-- exactly this one, scoped `IN SCHEMA extensions`, and fails any other.
--
-- Staging has 49 postgres-owned functions in `extensions`, 48 of them carrying
-- PUBLIC. This file does not touch any of them: default privileges apply only
-- when an object is CREATED. Existing objects everywhere are untouched.
--
-- ── THE SIDE EFFECT, ACCEPTED ────────────────────────────────────────────
--
-- From now on, a new function that `anon` must call needs an explicit
-- `GRANT EXECUTE ... TO anon`. That is already the rule under F-62. And note
-- F-66 still applies as usual: CREATE OR REPLACE keeps a function's ACL, while
-- DROP + CREATE gets the new default — which, after this file, is the closed
-- one.
--
-- ── SCOPE ────────────────────────────────────────────────────────────────
-- Three ALTER DEFAULT PRIVILEGES statements and nothing else. No function, no
-- relation, no policy, no existing ACL anywhere.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — TWO-LANE. Both lanes have the gap. ──────────────────
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION ─────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  -- Without this schema the third statement is a syntax-valid no-op against a
  -- name that does not exist, and the carve-out silently would not exist.
  PERFORM 1 FROM pg_namespace WHERE nspname = 'extensions';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P32-0043-PRE-001: schema "extensions" does not exist. The global revoke '
      'below would then strip PUBLIC EXECUTE from every extension function this '
      'database later installs, with no carve-out to restore it'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- ALTER DEFAULT PRIVILEGES FOR ROLE postgres requires membership in postgres.
  -- Asserted here so a wrong-credential dispatch fails with a sentence instead
  -- of a permission error three statements later.
  IF NOT pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION
      'P32-0043-PRE-002: the current user (%) is not postgres and is not a member '
      'of postgres, so it cannot alter postgres''s default privileges', current_user
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE THREE STATEMENTS, IN THIS ORDER ──────────────────────────────────

-- 1 · removes the NAMED anon grant from the postgres/public delta. On
--     production this is the {anon=X, authenticated=X, service_role=X} entry
--     the 2026-09-25 reading found; on staging it is already absent and this
--     is a no-op. Repeated from 0037, idempotently, so this file stands alone.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- 2 · THE ONE THAT CLOSES THE GAP. Without it, anon still reaches every new
--     function through PUBLIC's built-in EXECUTE (F-65, C-A20).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3 · THE SANCTIONED CARVE-OUT — the only `... TO PUBLIC` permitted in Phase 1.
--     Statement 2 is global, so without this an extension installed or updated
--     later comes out with PUBLIC stripped and stops working for anon and
--     authenticated alike. Scoped to `extensions` and to nothing else.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- ── POSTCONDITION ────────────────────────────────────────────────────────
DO $postconditions$
DECLARE
  o    oid;
  acl  text;
  a    boolean;
  au   boolean;
BEGIN
  -- 1 · the GLOBAL entry exists and carries no PUBLIC item. Its existence is
  -- the point: while there is no global row, the built-in default applies in
  -- full and PUBLIC holds EXECUTE.
  PERFORM 1 FROM pg_default_acl d
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P32-0043-POST-001: there is no global FUNCTION default-privilege entry for '
      'postgres. The built-in default still applies and PUBLIC still holds EXECUTE'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0
     AND d.defaclobjtype = 'f' AND x.grantee = 0;
  IF FOUND THEN
    RAISE EXCEPTION 'P32-0043-POST-002: the global FUNCTION default still grants PUBLIC'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 2 · the public entry grants neither anon nor PUBLIC.
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
     AND d.defaclobjtype = 'f' AND (x.grantee = 0 OR x.grantee = 'anon'::regrole);
  IF FOUND THEN
    RAISE EXCEPTION
      'P32-0043-POST-003: the postgres/public FUNCTION default still grants anon or PUBLIC'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 3 · the extensions entry DOES carry PUBLIC. This is the carve-out, and a
  -- missing PUBLIC item here is the failure that would break the next
  -- CREATE EXTENSION rather than anything visible today.
  PERFORM 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) x
   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'extensions'::regnamespace
     AND d.defaclobjtype = 'f' AND x.grantee = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'P32-0043-POST-004: the extensions FUNCTION default does not grant PUBLIC. '
      'The global revoke above would then strip PUBLIC EXECUTE from every extension '
      'function installed or updated after this migration'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 4 · THE PROBE. The catalogue rows above say what the defaults are; this
  -- creates a real SECURITY DEFINER function in `public`, reads the privileges
  -- it was actually born with, and drops it again, inside this transaction. A
  -- default-privilege change is exactly the kind of thing whose catalogue row
  -- can look right while the merged result is not (F-65), so the merged result
  -- is what is asserted.
  --
  -- It carries `SET search_path = ''` because it is SECURITY DEFINER, and this
  -- repository's own security rule (secdef-no-search-path, HIGH) applies to
  -- every such function without exception — including one that exists for three
  -- statements inside a transaction and is dropped before COMMIT. Correction
  -- C-A22: the first version of this file omitted the pin and the required
  -- Security check failed it. The pin does not change what is measured; the
  -- function's body is `SELECT` and resolves nothing.
  EXECUTE 'CREATE FUNCTION public._p32r_probe() RETURNS void LANGUAGE sql '
          'SECURITY DEFINER SET search_path = '''' AS $probe$ SELECT $probe$';
  -- Looked up dynamically rather than as a `'public._p32r_probe()'::regprocedure`
  -- literal: plpgsql folds such a literal into its cached plan, and on a second
  -- execution the cached oid points at the dropped function.
  SELECT p.oid INTO o FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_p32r_probe';
  acl := coalesce((SELECT proacl::text FROM pg_proc WHERE oid = o), '(null: built-in default)');
  a   := has_function_privilege('anon', o, 'EXECUTE');
  au  := has_function_privilege('authenticated', o, 'EXECUTE');
  EXECUTE 'DROP FUNCTION public._p32r_probe()';

  IF a THEN
    RAISE EXCEPTION
      'P32-0043-POST-005: a newly created SECURITY DEFINER function in public is '
      'STILL anon-executable. acl=%. The recurrence is not closed', acl
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NOT au THEN
    RAISE EXCEPTION
      'P32-0043-POST-006: a newly created function in public is no longer executable '
      'by authenticated. acl=%. This file must close anon, not the application', acl
      USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'P32-0043: a new SECURITY DEFINER function in public is born %, anon=false, authenticated=true', acl;
END
$postconditions$;

COMMIT;
