-- P33 clause 3 — the two leftover RLS-enabled tables, retired: grants revoked.
--
-- =============================================================================
-- WHAT THIS FIXES
--
-- `docs/gates/GATE_REGISTER.md` P33 (verbatim): "...the two leftover
-- RLS-enabled tables retired..." `docs/gates/P1-revocation-list.md` §1
-- documented the precise shape of the problem, measured on staging before
-- this file existed:
--
--   table                              | grants (anon)  | RLS      | policies
--   categories_migration_dropped       | arwdDxtm       | enabled  | 0
--   posts_dead_host_backup_20260812    | arwdDxtm       | enabled  | 0
--
-- RLS enabled with zero policies already denies every row to a non-owner role
-- for SELECT/INSERT/UPDATE/DELETE — so neither table is readable or writable
-- through PostgREST today. But RLS does NOT cover TRUNCATE, REFERENCES or
-- TRIGGER (the same gap `newTableGrants.test.ts` polices for new tables), and
-- the dangling `anon=arwdDxtm` grant is, in the frozen list's own words, "one
-- added policy — or one DISABLE ROW LEVEL SECURITY — away from failing, on a
-- table that is a copy of `posts`." Silence in the grant is not a decision;
-- this file makes the decision explicit and removes the standing exposure.
--
-- =============================================================================
-- WHY THIS FILE EXISTS DESPITE THE FIX ALREADY BEING LIVE ON STAGING
--
-- This exact REVOKE was applied to staging (`fpszggreishhuvdpkmdr`) on
-- 2026-09-15 through the Supabase MCP `apply_migration` tool, not through
-- `apply-migration.yml`, and was never captured as a committed migration
-- file — exactly the "process debt" `claude/2026-09-15-phase1-status-done-
-- and-pending.md` §4 names. Nothing here changes staging's current ACL; this
-- file exists so that a staging reset (which has already happened once, per
-- `claude/supabase-staging-migration-status.md`) reproduces the fix instead
-- of silently losing it, and so `apply-migration.yml` has a real run number
-- for it. REVOKE is naturally idempotent, so applying this against a
-- database that already has the 2026-09-15 state is a no-op, verified below.
--
-- =============================================================================
-- posts_dead_host_backup_20260812 — `service_role` IS DELIBERATELY KEPT
--
-- `supabase/functions/detect-orphan-files/index.ts` reads this table by name
-- (also asserted by `src/__tests__/orphanReferenceSet.test.ts:186`,
-- `expect(code).toMatch(/posts_dead_host_backup_20260812/)`), invoked with
-- `service_role`. Revoking `service_role` here would silently break orphan
-- detection. This file revokes only `anon` and `authenticated`.
--
-- =============================================================================
-- categories_migration_dropped — no known reader; anon AND authenticated
-- revoked. `service_role` (the owning role's implicit grant) is untouched —
-- this file only ever revokes named non-owner roles, never `postgres`.
--
-- =============================================================================
-- PRECONDITION — refuse rather than guess if RLS has been turned off since
-- the frozen list's reading. This migration's whole safety argument rests on
-- RLS already covering SELECT/INSERT/UPDATE/DELETE; if that has changed, the
-- REVOKE alone would not be doing the job the gate asks for, and the operator
-- needs to know before, not after.
-- =============================================================================

DO $pre$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t.relname, ', ')
    INTO v_missing
    FROM (VALUES ('categories_migration_dropped'), ('posts_dead_host_backup_20260812')) AS want(relname)
    JOIN pg_class t ON t.relname = want.relname
    JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
   WHERE t.relrowsecurity IS DISTINCT FROM true;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'P33 PRECONDITION FAILED — RLS is not enabled on: %. This migration only revokes grants; it does not itself enable RLS, and revoking grants without RLS covering the row-level verbs would not retire the table the way the gate requires. Fix RLS first.', v_missing;
  END IF;
END;
$pre$;

REVOKE ALL ON TABLE public.categories_migration_dropped FROM anon, authenticated;
REVOKE ALL ON TABLE public.posts_dead_host_backup_20260812 FROM anon, authenticated;

COMMENT ON TABLE public.categories_migration_dropped IS
  'Legacy table from the 2026-08-12 category-taxonomy migration. RLS enabled, zero policies (denies everyone but the owner already). P33: anon/authenticated grants revoked 2026-09-21 (durable capture of the 2026-09-15 staging fix) — no known reader; retired.';

COMMENT ON TABLE public.posts_dead_host_backup_20260812 IS
  'Dead-host backup copy of posts, pre-2026-08-12. RLS enabled, zero policies (denies everyone but the owner already). P33: anon/authenticated grants revoked 2026-09-21 (durable capture of the 2026-09-15 staging fix). service_role KEPT — supabase/functions/detect-orphan-files/index.ts reads this table by name; revoking service_role here would break orphan detection.';

-- =============================================================================
-- VERIFY AFTER RUNNING
--
--   SELECT c.relname, c.relacl::text
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND c.relname IN ('categories_migration_dropped','posts_dead_host_backup_20260812');
--
--   expect categories_migration_dropped     -> {postgres=arwdDxtm/postgres}
--   expect posts_dead_host_backup_20260812  -> {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- Matches the live staging reading taken 2026-09-21 before this file was
-- written (PROBE_p33_leftover_rls_tables_closed.sql is the same query).
-- =============================================================================
