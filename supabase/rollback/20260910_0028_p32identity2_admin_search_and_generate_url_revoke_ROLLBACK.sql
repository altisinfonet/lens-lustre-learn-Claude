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
-- ═════════════════════════════════════════════════════════════════════════
-- THE LANE HAZARD — RULED BY THE AUDITOR (R-9) AND NOW ENFORCED IN THIS FILE
--
-- The same hazard as `0027`, tracked as BLOCKER-C in
-- docs/evidence/d1/phase1/R8-BLOCKERS-20260922.md, which R-9 closes as
-- **ruled**, not as solved. On production the four Set C objects are already
-- closed to `anon`; this rollback would open them. The marker technique `0038`
-- uses is unavailable here, because `0028` is merged and §8 forbids editing it,
-- so it cannot record anything for its rollback.
--
-- R-9's remedy is therefore an ASSERTION, not a detection. The guard placed
-- immediately after `BEGIN;` below — before the first `GRANT` of any kind,
-- which here means before both the `anon` grants and the `authenticated` grant
-- on `generate_custom_url` — refuses to run unless the invoking session has
-- asserted the lane. It is executable and fatal. The previous revision of this
-- file carried the same constraint as prose, and a comment is not a control.
--
--   RUN IT LIKE THIS, AND ONLY LIKE THIS:
--
--     SET p32.lane = 'staging';   -- in THIS session, BEFORE `BEGIN`
--     \i supabase/rollback/20260910_0028_p32identity2_admin_search_and_generate_url_revoke_ROLLBACK.sql
--
--   The comparison is exact and case-sensitive: 'Staging', 'STAGING',
--   ' staging', the empty string and unset all refuse.
--
--   **This file never sets `p32.lane` itself** — no `SET`, no `SET LOCAL`, no
--   `set_config()` for it anywhere below. A file that set its own assertion
--   would assert nothing.
--
--   No environmental discriminator is used, and none may be added:
--   `current_database()`, the pooler username, `plpgsql_check`'s schema
--   (itself a P33 target at ordinal `0031` — a guard reading it would silently
--   invert on the day that migration runs), project or host names, and
--   `pg_authid` / `pg_namespace` differences are all forbidden here.
--   Assertion only.
--
-- THIS CONSTRAINT IS NOT PERMANENT. It is lifted when EITHER:
--   (a) the R-13 lane interlock is live and apply-migration.yml sets p32.lane
--       from its own lane guard; OR
--   (b) the production ACL for the objects this file covers has been MEASURED
--       directly — not relayed — and this rollback has been re-cut against that
--       evidence.
-- Until one of those is true, this file runs on staging or it does not run.
--
-- IDEMPOTENCE — GRANT is idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. ─────────────────────────────
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback restores anon EXECUTE. On production these objects are '
      'closed, so running it there would open them. The file cannot detect its '
      'own lane, so it refuses unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

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
