-- ==========================================================================
-- ROLLBACK for 20260817102540_hashtag_grants_and_cascade.sql
-- hashtag grants and cascade
--
-- SUPERSEDES the previous rollback of the same name, which is withdrawn to
-- UNAPPLIED_20260817102540_hashtag_grants_and_cascade_ROLLBACK.sql under
-- Auditor ruling R-11/R-26. That file is neutralised, not deleted: its body is
-- preserved with every line commented, and it is recoverable byte for byte.
--
-- THE DEFECT: this rollback granted EXECUTE to PUBLIC. PUBLIC is every role,
-- so a later REVOKE ... FROM anon on the same object becomes a silent no-op
-- (F-62), and on the production lane it would create an exposure that lane has
-- never had (the UNAPPLIED_0023 hazard).
--
-- THE LINE(S) THIS FILE REPLACES, quoted verbatim from the superseded body:
--   grant execute on function public.recount_hashtags(uuid[]) to public;
--
-- --------------------------------------------------------------------------
-- WHAT THE APPLY ACTUALLY REMOVED -- read from the apply file, statement by
-- statement, never from the old rollback body, which is the thing being corrected.
--
--   public.recount_hashtags(uuid[])
--       REVOKE from : public, anon, authenticated
--       -> RESTORE   : anon, authenticated
--   public.suggest_hashtags(text, integer)
--       REVOKE from : public, anon
--       then GRANT to: authenticated
--       -> RESTORE   : anon
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
-- STAGING CATALOGUE CONTROL, measured 2026-09-22: these objects ALREADY carry
-- a PUBLIC ACL entry, so the control cannot say whether the superseded
-- rollback ever ran. Indeterminate, and recorded as such.
--
-- --------------------------------------------------------------------------
-- HOW TO RUN IT -- and the only way it will run. The R-9 guard below is
-- executable and fatal, and it sits after BEGIN; and before the first GRANT of
-- any kind.
--
--     SET p32.lane = 'staging';   -- in THIS session, BEFORE `BEGIN`
--     \i supabase/rollback/20260817102540_hashtag_grants_and_cascade_ROLLBACK.sql
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

GRANT EXECUTE ON FUNCTION public.recount_hashtags(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_hashtags(text, integer) TO anon;

DO $verify$
DECLARE bad int := 0; missing int := 0; o oid;
BEGIN
  o := to_regprocedure('public.recount_hashtags(uuid[])')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.recount_hashtags(uuid[]) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.recount_hashtags(uuid[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.recount_hashtags(uuid[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.recount_hashtags(uuid[]) after rollback';
  END IF;
  o := to_regprocedure('public.suggest_hashtags(text, integer)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.suggest_hashtags(text, integer) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.suggest_hashtags(text, integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.suggest_hashtags(text, integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.suggest_hashtags(text, integer) after rollback';
  END IF;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  IF missing > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- % named grant(s) that must be present after this rollback are absent. A rollback that restores nothing must still leave the surviving grants intact. Transaction aborted.', missing;
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED -- 2 object(s) granted, 2 object(s) checked, PUBLIC absent on all 2, named grantees intact.';
END $verify$;

COMMIT;
