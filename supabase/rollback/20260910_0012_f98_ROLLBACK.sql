-- ==========================================================================
-- ROLLBACK for 20260910_0012_f98_revoke_from_public.sql
-- F-98 — the custom-url / username surface
--
-- CORRECTED IN PLACE under Auditor ruling R-11/R-26. The history of this file
-- carries the defect; git is the record of what it used to say.
--
-- THE DEFECT: this rollback granted EXECUTE to PUBLIC. PUBLIC is every role,
-- so a later REVOKE ... FROM anon on the same object becomes a silent no-op
-- (F-62), and on the production lane it would create an exposure that lane has
-- never had (the UNAPPLIED_0023 hazard).
--
-- THE LINE(S) THIS FILE REPLACES, quoted verbatim from the superseded body:
--   GRANT EXECUTE ON FUNCTION public.clear_custom_url() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.change_custom_url(text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.claim_username(text) TO PUBLIC;
--
-- --------------------------------------------------------------------------
-- WHAT THE APPLY ACTUALLY REMOVED -- read from the apply file, statement by
-- statement, never from the old rollback body, which is the thing being corrected.
--
--   public.clear_custom_url()
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.change_custom_url(text)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: authenticated
--       -> RESTORE   : anon, authenticated
--   public.claim_username(text)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: authenticated
--       -> RESTORE   : anon, authenticated
--   public.custom_url_available(text, uuid)
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.custom_url_ever_held(uuid)
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.custom_url_slug(text)
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.custom_url_transliterate(text)
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.custom_url_fold_accents(text)
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.forbid_custom_url_change()
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.prevent_direct_custom_url_update()
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.tg_custom_url_reject_reserved()
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.tg_profiles_assign_custom_url()
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.tg_profiles_record_custom_url_history()
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--
-- PRIVILEGE-EQUIVALENT WHERE IT MATTERS, DELIBERATELY NOT BYTE-EQUAL. The
-- apply removed PUBLIC as well as the named roles. This file restores the
-- named roles and NOT PUBLIC. The difference: on staging, PUBLIC-by-name is
-- not put back, so any role that reached these objects only through PUBLIC
-- does not regain access. Every role the apply named individually does.
--
-- DERIVATION CAVEAT, stated rather than buried: the restore set above comes
-- from the apply's own REVOKE list, as R-26 3.3 directs. It is not a
-- measurement of the pre-apply ACL. A REVOKE naming a role is not proof that
-- the role held a named grant -- that is exactly how 0029 failed, where
-- supabase_auth_admin reached the function through PUBLIC and held nothing of
-- its own. On production the difference is unmeasurable today (BLOCKER-B).
--
-- STAGING CATALOGUE CONTROL, measured 2026-09-22: none of the objects below
-- carries a PUBLIC ACL entry, so the superseded rollback has NOT run on
-- staging by any route, including the out-of-band route that is a standing
-- finding.
--
-- --------------------------------------------------------------------------
-- HOW TO RUN IT -- and the only way it will run. The R-9 guard below is
-- executable and fatal, and it sits after BEGIN; and before the first GRANT of
-- any kind.
--
--     SET p32.lane = 'staging';   -- in THIS session, BEFORE `BEGIN`
--     \i supabase/rollback/20260910_0012_f98_ROLLBACK.sql
--
-- The comparison is exact and case-sensitive. Every one of these refuses:
--     'Staging'   'STAGING'   ' staging'   'staging '   ''   (and unset)
-- This file never sets p32.lane itself -- no SET, no SET LOCAL, no set_config
-- for that key anywhere below. A file that set its own assertion would assert
-- nothing.
--
-- THIS CONSTRAINT IS NOT PERMANENT. It is lifted when EITHER:
--   (a) the R-13 lane interlock is live and apply-migration.yml sets p32.lane
--       from its own lane guard; OR
--   (b) the production ACL for the objects this file covers has been MEASURED
--       directly -- not relayed -- and this rollback has been re-cut against that
--       evidence.
-- Until one of those is true, this file runs on staging or it does not run.
--
-- IDEMPOTENCE -- GRANT is idempotent; re-running changes nothing.
-- ==========================================================================

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

GRANT EXECUTE ON FUNCTION public.clear_custom_url() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_custom_url(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_username(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_url_available(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_url_ever_held(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_url_slug(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_url_transliterate(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_url_fold_accents(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forbid_custom_url_change() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_direct_custom_url_update() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_custom_url_reject_reserved() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_profiles_assign_custom_url() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_profiles_record_custom_url_history() TO anon, authenticated;

DO $verify$
DECLARE bad int := 0; missing int := 0; o oid;
BEGIN
  o := to_regprocedure('public.clear_custom_url()')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.clear_custom_url() does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.clear_custom_url() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.clear_custom_url() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.clear_custom_url() after rollback';
  END IF;
  o := to_regprocedure('public.change_custom_url(text)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.change_custom_url(text) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.change_custom_url(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.change_custom_url(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.change_custom_url(text) after rollback';
  END IF;
  o := to_regprocedure('public.claim_username(text)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.claim_username(text) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.claim_username(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.claim_username(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.claim_username(text) after rollback';
  END IF;
  o := to_regprocedure('public.custom_url_available(text, uuid)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.custom_url_available(text, uuid) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.custom_url_available(text, uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.custom_url_available(text, uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.custom_url_available(text, uuid) after rollback';
  END IF;
  o := to_regprocedure('public.custom_url_ever_held(uuid)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.custom_url_ever_held(uuid) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.custom_url_ever_held(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.custom_url_ever_held(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.custom_url_ever_held(uuid) after rollback';
  END IF;
  o := to_regprocedure('public.custom_url_slug(text)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.custom_url_slug(text) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.custom_url_slug(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.custom_url_slug(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.custom_url_slug(text) after rollback';
  END IF;
  o := to_regprocedure('public.custom_url_transliterate(text)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.custom_url_transliterate(text) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.custom_url_transliterate(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.custom_url_transliterate(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.custom_url_transliterate(text) after rollback';
  END IF;
  o := to_regprocedure('public.custom_url_fold_accents(text)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.custom_url_fold_accents(text) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.custom_url_fold_accents(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.custom_url_fold_accents(text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.custom_url_fold_accents(text) after rollback';
  END IF;
  o := to_regprocedure('public.forbid_custom_url_change()')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.forbid_custom_url_change() does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.forbid_custom_url_change() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.forbid_custom_url_change() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.forbid_custom_url_change() after rollback';
  END IF;
  o := to_regprocedure('public.prevent_direct_custom_url_update()')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.prevent_direct_custom_url_update() does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.prevent_direct_custom_url_update() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.prevent_direct_custom_url_update() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.prevent_direct_custom_url_update() after rollback';
  END IF;
  o := to_regprocedure('public.tg_custom_url_reject_reserved()')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.tg_custom_url_reject_reserved() does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.tg_custom_url_reject_reserved() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.tg_custom_url_reject_reserved() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.tg_custom_url_reject_reserved() after rollback';
  END IF;
  o := to_regprocedure('public.tg_profiles_assign_custom_url()')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.tg_profiles_assign_custom_url() does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.tg_profiles_assign_custom_url() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.tg_profiles_assign_custom_url() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.tg_profiles_assign_custom_url() after rollback';
  END IF;
  o := to_regprocedure('public.tg_profiles_record_custom_url_history()')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.tg_profiles_record_custom_url_history() does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.tg_profiles_record_custom_url_history() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.tg_profiles_record_custom_url_history() after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.tg_profiles_record_custom_url_history() after rollback';
  END IF;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  IF missing > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- % named grant(s) that must be present after this rollback are absent. A rollback that restores nothing must still leave the surviving grants intact. Transaction aborted.', missing;
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED -- 13 object(s) granted, 13 object(s) checked, PUBLIC absent on all 13, named grantees intact.';
END $verify$;

COMMIT;
