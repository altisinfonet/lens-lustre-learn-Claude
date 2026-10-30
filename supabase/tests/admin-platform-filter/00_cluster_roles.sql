-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · admin users platform filter (20261103_0101) · cluster roles (idempotent).
-- THROWAWAY DATABASE ONLY — scripts/db-admin-platform-filter-fixture.mjs runs this
-- against a CI service container or an in-process PGlite, never a Supabase
-- project (the runner refuses any host that is not local).
-- The three API roles Supabase gives every project. NOLOGIN: the fixture
-- reaches them with SET ROLE, exactly as PostgREST does.
-- ═══════════════════════════════════════════════════════════════════════════
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$roles$;
