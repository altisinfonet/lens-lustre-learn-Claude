-- ROLLBACK for 20260910_0041_p33_get_primary_admin_user_id_revoke_anon.sql — P33 clause 5.
--
-- Restores anon's EXECUTE on public.get_primary_admin_user_id(), i.e.
-- REOPENS anonymous resolution of the earliest-created admin's user_id.
--
-- =============================================================================
-- ⚠ WHAT RUNNING THIS COSTS
--
-- This is not a neutral undo. It puts back the ability for any holder of the
-- public anon key to learn a real admin member's `user_id` in one call, with
-- no session and no argument. Nothing in the application depends on `anon`
-- holding this grant (searched 2026-09-21: no client call site at all, direct
-- or anonymous). Run it only to restore a caller this migration is found to
-- have broken, and treat finding that caller as the real fix.
--
-- =============================================================================
-- FIDELITY
--
-- Restores anon only. PUBLIC is not re-granted — the creating migration
-- (`20260704120420_3d0eaaec-…sql`) revoked PUBLIC deliberately and correctly;
-- re-granting it here would leave the function MORE open after a rollback
-- than the original design ever intended. `authenticated` and `service_role`
-- were never touched by either direction.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.get_primary_admin_user_id() TO anon;

COMMENT ON FUNCTION public.get_primary_admin_user_id() IS
  'Resolves the earliest-created admin user_id. ⚠ P33 closure was ROLLED BACK — anon can again resolve a real admin user_id in one call, with no session and no argument. Re-apply supabase/migrations/20260910_0041_p33_get_primary_admin_user_id_revoke_anon.sql once the reason for the rollback is resolved.';

-- =============================================================================
-- VERIFY AFTER RUNNING
--
--   SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'get_primary_admin_user_id';
--
--   expect anon_exec = true.
--
-- ⚠ PROBE_p33_get_primary_admin_user_id_closed.sql WILL FAIL after this runs
-- — that is correct; it is the gate assertion, deliberately reopened. Do not
-- "fix" the probe.
-- =============================================================================
