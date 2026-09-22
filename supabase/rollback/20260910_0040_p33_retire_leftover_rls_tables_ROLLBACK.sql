-- ROLLBACK for 20260910_0040_p33_retire_leftover_rls_tables.sql — P33 clause 3.
--
-- Restores anon and authenticated's full DML grant (arwdDxtm) on
-- `categories_migration_dropped` and `posts_dead_host_backup_20260812`.
--
-- =============================================================================
-- ⚠ WHAT RUNNING THIS COSTS
--
-- RLS (enabled, zero policies on both tables) still denies SELECT / INSERT /
-- UPDATE / DELETE to anon and authenticated after this rollback runs — that
-- part of the exposure does not return. What DOES return is TRUNCATE,
-- REFERENCES and TRIGGER, none of which RLS can refuse, on two tables the
-- P1-revocation-list itself describes as "one added policy — or one DISABLE
-- ROW LEVEL SECURITY — away from failing, on a table that is a copy of
-- `posts`." Run this only to restore a caller this migration is found to have
-- broken; if that happens, the actual caller is the thing to find and fix,
-- not something either of these two dead tables should legitimately need.
--
-- =============================================================================
-- FIDELITY — restores exactly the grants revoked, nothing wider
--
-- The apply only ever revoked `anon` and `authenticated`; `service_role` on
-- `posts_dead_host_backup_20260812` and the bare owner grant on both tables
-- were never touched, so this file does not grant service_role or re-touch
-- ownership. Full DML (arwdDxtm), matching the pre-migration state read on
-- staging 2026-09-15/2026-09-21.
-- =============================================================================

GRANT ALL ON TABLE public.categories_migration_dropped TO anon, authenticated;
GRANT ALL ON TABLE public.posts_dead_host_backup_20260812 TO anon, authenticated;

COMMENT ON TABLE public.categories_migration_dropped IS
  'Legacy table from the 2026-08-12 category-taxonomy migration. ⚠ P33 retirement was ROLLED BACK — anon/authenticated hold full DML again (RLS with zero policies still blocks row-level access; TRUNCATE/REFERENCES/TRIGGER do not). Re-apply supabase/migrations/20260910_0040_p33_retire_leftover_rls_tables.sql once the reason for the rollback is resolved.';

COMMENT ON TABLE public.posts_dead_host_backup_20260812 IS
  'Dead-host backup copy of posts, pre-2026-08-12. ⚠ P33 retirement was ROLLED BACK — anon/authenticated hold full DML again. service_role access (detect-orphan-files) was never affected by either direction. Re-apply supabase/migrations/20260910_0040_p33_retire_leftover_rls_tables.sql once the reason for the rollback is resolved.';

-- =============================================================================
-- VERIFY AFTER RUNNING
--
--   SELECT c.relname, c.relacl::text
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND c.relname IN ('categories_migration_dropped','posts_dead_host_backup_20260812');
--
--   expect both to show anon=arwdDxtm and authenticated=arwdDxtm again.
--
-- ⚠ PROBE_p33_leftover_rls_tables_closed.sql WILL FAIL after this runs — that
-- is correct; it is the gate assertion, deliberately reopened. Do not "fix"
-- the probe.
-- =============================================================================
