-- ── P33 · 0044 fixture · scratch PostgreSQL 17 only. ────────────────────
-- plpgsql_check installed in `public`, the way production has it, built with
-- the PRIVILEGE SHAPE measured on staging on 2026-09-25 (SELECT only):
--
--   * the extension is owned by `supabase_admin`, the superuser that supautils
--     delegates privileged-extension DDL to. Here `supabase_admin` is a real
--     superuser login role, and running the migration AS it is how this
--     fixture stands in for supautils' delegation. That is the one thing this
--     fixture cannot reproduce: the delegation itself. It models the result.
--   * `postgres_nonsuper` is a non-superuser login role, not a member of
--     supabase_admin — the shape of the platform's `postgres` role WITHOUT
--     supautils. Used for one step only: to show the file refuses cleanly when
--     nothing can delegate for it.
--   * supabase_admin's default privileges for FUNCTIONS, copied from staging:
--       public      {postgres=X, anon=X, authenticated=X, service_role=X}
--       extensions  {postgres=X*}          (with grant option)
--     These decide the ACL every plpgsql_check function is BORN with, in each
--     schema. They are staging's, not a production reading — production's
--     plpgsql_check ACLs were not in the 2026-09-25 reading.
--   * schema `extensions`, owned by postgres, USAGE to anon/authenticated/
--     service_role, as on staging.
--
-- The local plpgsql_check is whatever this cluster has (2.10 at the time of
-- writing; staging runs 2.8). 0044 is version-agnostic: it captures the version
-- and asserts it is unchanged, so the member count differs by version and the
-- tests read it rather than hard-coding it.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')              THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')     THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')      THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin')    THEN CREATE ROLE supabase_admin LOGIN SUPERUSER; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres_nonsuper') THEN CREATE ROLE postgres_nonsuper LOGIN NOSUPERUSER CREATEROLE; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions
  GRANT EXECUTE ON FUNCTIONS TO postgres WITH GRANT OPTION;

-- the install, as the delegated superuser, into `public`
SET ROLE supabase_admin;
CREATE EXTENSION plpgsql_check WITH SCHEMA public;
RESET ROLE;

-- the fixture asserts its own shape
DO $v$
DECLARE e record; n_pub int; n_anon int;
BEGIN
  SELECT extname, extversion, extnamespace::regnamespace::text AS nsp, pg_get_userbyid(extowner) AS owner
    INTO e FROM pg_extension WHERE extname = 'plpgsql_check';
  IF e.nsp <> 'public' OR e.owner <> 'supabase_admin' THEN
    RAISE EXCEPTION 'fixture: expected plpgsql_check in public owned by supabase_admin, got % / %', e.nsp, e.owner;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO n_pub, n_anon
    FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
   WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
     AND d.refobjid = (SELECT oid FROM pg_extension WHERE extname='plpgsql_check')
     AND p.pronamespace = 'public'::regnamespace;
  RAISE NOTICE 'FIXTURE BUILT (0044): plpgsql_check % in public, owner supabase_admin, % member functions in public, % anon-executable',
    e.extversion, n_pub, n_anon;
END $v$;

-- No helper function is stored here. The first draft kept an ACL-digest
-- function in `public` whose body mentioned plpgsql_check, and 0044's own
-- precondition P33-0044-PRE-006 refused to run because of it: a function body
-- outside the extension that names the extension. That is the guard doing its
-- job on the fixture's own scaffolding, so the digest now lives in the harness
-- as a plain query and the fixture contains nothing the migration would trip on.
