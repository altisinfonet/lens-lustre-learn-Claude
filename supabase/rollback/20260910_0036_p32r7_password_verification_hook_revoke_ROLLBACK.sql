-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0036_p32r7_password_verification_hook_revoke.sql
-- Identical stem, as required. ONE object.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor allocation R-7.
--
-- ═════════════════════════════════════════════════════════════════════════
-- THE TWO MEASURED STARTING ACLs — this file participates in the two-fixture
-- validation because the lanes differ in TWO ways, not one.
--
--   STAGING  fpszggreishhuvdpkmdr — measured by SELECT, 2026-09-22T06:45Z:
--     =X/postgres | postgres=X/postgres | anon=X/postgres |
--     authenticated=X/postgres | service_role=X/postgres
--     → staging HELD PUBLIC · named supabase_auth_admin entries = **0**
--
--   PRODUCTION jtdtehuqtinjxropkkcn — RELAYED, not measured here (BLOCKER-B):
--     postgres | service_role | supabase_auth_admin
--     → production did NOT hold PUBLIC · named supabase_auth_admin = **yes**
--
-- ═════════════════════════════════════════════════════════════════════════
-- WHAT THIS ROLLBACK DOES, AND THE TWO THINGS IT REFUSES TO DO
--
--   RESTORED     : `anon` and `authenticated` EXECUTE — the named grants the
--                  apply removed.
--   NEVER ISSUED : `GRANT EXECUTE ... TO PUBLIC`. On any lane. Ever.
--                  (UNAPPLIED_0023 hazard — see `0033`'s rollback header.)
--   NEVER REVOKED: the `supabase_auth_admin` grant. **This is the second
--                  hazard and it runs the opposite way to the first.**
--
-- ⚠ WHY THE AUTH-ADMIN GRANT IS NOT REVOKED, EVEN THOUGH THE APPLY ADDED IT.
-- A perfect inverse would revoke it, because on staging it did not exist
-- before. But on PRODUCTION that grant PRE-EXISTS and is GoTrue's only named
-- path to the hook. A rollback that revoked it there would break password
-- verification on production — the exact outage the apply file was written to
-- avoid, caused by the file meant to undo it.
--
-- So the residue on staging is one extra named grant to `supabase_auth_admin`.
-- That is strictly safer than the PUBLIC route it replaced: the same role
-- keeps the same reach, by name instead of by "everyone". A rollback that
-- leaves the system marginally MORE closed than it found it is acceptable.
-- One that leaves it more open is not.
--
-- BOTH residues are deliberate, and both are the same principle: **between
-- under-restoring on staging and breaking production, under-restore.**
--
-- ⚠ SAME ADJACENT HAZARD AS `0032` AND `0034` — BLOCKER-C. On production this
-- object is already closed to anon and authenticated; running this rollback
-- there would grant both on an auth hook whose body trusts a caller-supplied
-- user_id. **OPERATING CONSTRAINT UNTIL THE AUDITOR RULES: STAGING ONLY.**
--
-- IDEMPOTENCE — GRANT is idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.password_verification_hook(event jsonb) TO authenticated;

-- supabase_auth_admin is deliberately left in place — see the header.

DO $verify$
DECLARE pub int;
BEGIN
  SELECT count(*) INTO pub FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = to_regprocedure('public.password_verification_hook(jsonb)')::oid
     AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF pub > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — PUBLIC holds EXECUTE after rollback (% entr(y/ies)). This file must never create a PUBLIC grant. Transaction aborted.', pub;
  END IF;
  IF NOT has_function_privilege('supabase_auth_admin',
        to_regprocedure('public.password_verification_hook(jsonb)')::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — supabase_auth_admin lost EXECUTE. On production that is GoTrue''s only named path to this hook and sign-in would break.';
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED — anon and authenticated restored, PUBLIC absent, supabase_auth_admin intact.';
END $verify$;

COMMIT;
