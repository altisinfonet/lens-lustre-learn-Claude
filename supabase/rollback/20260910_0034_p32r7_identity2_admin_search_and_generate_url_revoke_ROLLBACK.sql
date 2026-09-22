-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0034_p32r7_identity2_admin_search_and_generate_url_revoke.sql
-- Identical stem, as required. Four Set C objects.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor allocation R-7.
--
-- RESTORED    : `anon` EXECUTE — the only named grant the apply removed.
-- NEVER ISSUED: `GRANT EXECUTE ... TO PUBLIC`. On any lane. Ever.
--
-- Staging's measured starting ACL carried PUBLIC (2026-09-22T06:45Z);
-- production's does not (RELAYED, BLOCKER-B). A faithful inverse of staging
-- would create a PUBLIC grant on production that has never existed there —
-- the UNAPPLIED_0023 hazard. So the rollback under-restores on staging, by
-- design, and that difference is documented rather than closed silently.
--
-- ⚠ SAME ADJACENT HAZARD AS `0032` — see BLOCKER-C in
-- docs/evidence/d1/phase1/R7-BLOCKERS-20260922.md. These four are ALREADY
-- CLOSED to `anon` on production (relayed). Running this rollback there would
-- GRANT `anon` EXECUTE on three functions that return member e-mail and
-- certificate-recipient data. The file cannot detect its own lane
-- (`current_database()` is `postgres` on both; the pooler username
-- `apply-migration.yml` inspects is not visible to SQL), and D1 has not
-- invented an interlock, because a lane guard is an operating convention and
-- conventions are the Auditor's.
--
--   **OPERATING CONSTRAINT UNTIL THE AUDITOR RULES: STAGING ONLY. Do not run
--   this rollback against production.**
--
-- IDEMPOTENCE — GRANT is idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.admin_list_certificates(_query text, _type text, _limit integer, _offset integer) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_search_certificate_recipients(_query text, _limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer) TO anon;
GRANT EXECUTE ON FUNCTION public.generate_custom_url(_full_name text, _user_id uuid) TO anon;

DO $verify$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'admin_list_certificates','admin_search_certificate_recipients',
       'admin_search_users_v2','generate_custom_url')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(p2.proacl) a
                WHERE p2.oid = r.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      bad := bad + 1;
      RAISE WARNING 'PUBLIC holds EXECUTE on public.% after rollback', r.proname;
    END IF;
  END LOOP;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED — anon restored on 4 objects, PUBLIC absent on all 4.';
END $verify$;

COMMIT;
