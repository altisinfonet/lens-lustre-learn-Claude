-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for the MERGED
-- 20260910_0028_p32identity2_admin_search_and_generate_url_revoke.sql
-- Identical stem, as required. Five objects.
--
-- ⚠ GAP-FILLING, NOT RECOVERY. The apply is merged on `staging` (`0869a94`,
-- PR #274) and has never been dispatched — `schema_migrations` holds 8 rows,
-- latest `20260915130151`, measured 2026-09-22T08:42Z. This file exists because
-- the apply shipped without it (skill §3, "no exceptions").
--
-- **The merged apply file is NOT modified by this unit** (§8). Rollback only.
--
-- ═════════════════════════════════════════════════════════════════════════
-- WHAT THE APPLY REMOVES — read from the merged file
--
-- Unlike `0027`, this one revokes and then **re-grants explicitly**:
--
--   admin_search_users                   REVOKE FROM PUBLIC, anon  → GRANT authenticated, service_role
--   admin_search_users_v2                REVOKE FROM PUBLIC, anon  → GRANT authenticated, service_role
--   admin_list_certificates              REVOKE FROM PUBLIC, anon  → GRANT authenticated, service_role
--   admin_search_certificate_recipients  REVOKE FROM PUBLIC, anon  → GRANT authenticated, service_role
--   generate_custom_url                  REVOKE FROM PUBLIC, anon, authenticated → GRANT service_role
--
-- That explicit re-grant is the safer pattern, and worth naming as such: it
-- would still be correct if a named entry were missing, whereas `0027`'s
-- retention-by-omission would not. Same family as the withdrawn `0029`'s
-- defect, avoided here by construction rather than by luck.
--
-- So this rollback restores:
--   · `anon` on all five — removed by every object's revoke;
--   · `authenticated` on `generate_custom_url` ONLY — the one object whose
--     revoke took it. Verified present before the apply: `authenticated` NAMED
--     = true, staging 2026-09-22T08:42Z.
-- `service_role` is not restored anywhere: the apply granted it, never removed
-- it.
--
-- ═════════════════════════════════════════════════════════════════════════
-- PUBLIC IS NEVER RE-GRANTED, ON ANY LANE, EVER
--
--   STAGING, 2026-09-22T08:42Z — all five carry `=X/postgres`. PUBLIC: held.
--   PRODUCTION — RELAYED, not measured here: the four Set C objects are already
--   closed; `admin_search_users(text, text)` reads
--   `postgres | anon | authenticated | service_role`.          PUBLIC: NOT held.
--
-- Restoring staging's PUBLIC on production would create an exposure that never
-- existed there — the UNAPPLIED_0023 hazard — on functions that return member
-- e-mail addresses and certificate-recipient records. Three of these five
-- answer a question about a named person, which is precisely the class the
-- platform rule forbids exposing to `anon`.
--
-- ⚠ SAME ADJACENT HAZARD AS `0027` — BLOCKER-C in
-- docs/evidence/d1/phase1/R8-BLOCKERS-20260922.md. On production the four Set C
-- objects are already closed to `anon`; this rollback would open them. The
-- marker technique `0038` uses is unavailable here, because `0028` is merged
-- and §8 forbids editing it, so it cannot record anything for its rollback.
--
--   **OPERATING CONSTRAINT UNTIL THE AUDITOR RULES: STAGING ONLY. Do not run
--   this rollback against production.**
--
-- IDEMPOTENCE — GRANT is idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.admin_search_users(search_query text, search_by text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_list_certificates(_query text, _type text, _limit integer, _offset integer) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_search_certificate_recipients(_query text, _limit integer) TO anon;

-- generate_custom_url is the only object whose revoke took `authenticated`.
GRANT EXECUTE ON FUNCTION public.generate_custom_url(_full_name text, _user_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.generate_custom_url(_full_name text, _user_id uuid) TO authenticated;

DO $verify$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'admin_search_users','admin_search_users_v2','admin_list_certificates',
       'admin_search_certificate_recipients','generate_custom_url')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(p2.proacl) a
                WHERE p2.oid = r.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      bad := bad + 1; RAISE WARNING 'PUBLIC holds EXECUTE on public.% after rollback', r.proname;
    END IF;
  END LOOP;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  IF NOT has_function_privilege('service_role', to_regprocedure('public.generate_custom_url(text, uuid)')::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — generate_custom_url lost service_role, which the apply granted and this rollback does not touch.';
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED — anon restored on 5 objects, authenticated restored on generate_custom_url, PUBLIC absent on all 5.';
END $verify$;

COMMIT;
