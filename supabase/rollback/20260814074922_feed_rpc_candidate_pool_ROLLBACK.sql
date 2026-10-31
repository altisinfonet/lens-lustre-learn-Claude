-- ==========================================================================
-- ROLLBACK for 20260814074922_feed_rpc_candidate_pool.sql
-- the broadcast feed candidate pool
--
-- SUPERSEDES the previous rollback of the same name, which is withdrawn to
-- UNAPPLIED_20260814074922_feed_rpc_candidate_pool_ROLLBACK.sql under Auditor
-- ruling R-11/R-26. That file is neutralised, not deleted: its body is
-- preserved with every line commented, and it is recoverable byte for byte.
--
-- THE DEFECT: this rollback granted EXECUTE to PUBLIC. PUBLIC is every role,
-- so a later REVOKE ... FROM anon on the same object becomes a silent no-op
-- (F-62), and on the production lane it would create an exposure that lane has
-- never had (the UNAPPLIED_0023 hazard).
--
-- THE LINE(S) THIS FILE REPLACES, quoted verbatim from the superseded body:
--   GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer) TO anon, authenticated, servi...
--   GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer) TO anon, authenticated, service_role, ...
--
-- --------------------------------------------------------------------------
-- WHAT THE APPLY ACTUALLY REMOVED -- read from the apply file, statement by
-- statement, never from the old rollback body, which is the thing being corrected.
--
--   public.get_broadcast_feed(uuid[], integer, integer, text[])
--       REVOKE from : public
--       then GRANT to: anon, authenticated, service_role
--       -> RESTORE   : (nothing -- see below)
--   public.get_broadcast_feed(uuid[], integer, integer)
--       REVOKE from : public
--       then GRANT to: anon, authenticated, service_role
--       -> RESTORE   : (nothing -- see below)
--   public.get_broadcast_feed(uuid[], integer)
--       REVOKE from : public
--       then GRANT to: anon, authenticated, service_role
--       -> RESTORE   : (nothing -- see below)
--
-- THIS FILE RESTORES NOTHING, AND THAT IS THE CORRECT INVERSE. The apply
-- removed only PUBLIC from these objects. PUBLIC is never restored, so there
-- is no grant left to put back. The file exists to assert the post-state and
-- to refuse to run on the wrong lane -- not to change an ACL.
--
-- A rollback that restores nothing would pass a naive post-condition for free.
-- This one therefore asserts that the named grantees which must SURVIVE are
-- present, object by object, so the check can still fail.
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
--     \i supabase/rollback/20260814074922_feed_rpc_candidate_pool_ROLLBACK.sql
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
      'This rollback asserts a post-state that differs between the lanes. It '
      'restores no grant on staging, and on production the objects it names are '
      'closed. The file cannot detect its own lane, so it refuses unless the '
      'lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- No GRANT is issued. The apply removed only PUBLIC, and PUBLIC is never
-- restored. See the header. The post-condition below is what this file does.

DO $verify$
DECLARE bad int := 0; missing int := 0; o oid;
BEGIN
  o := to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.get_broadcast_feed(uuid[], integer, integer, text[]) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.get_broadcast_feed(uuid[], integer, integer, text[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.get_broadcast_feed(uuid[], integer, integer, text[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.get_broadcast_feed(uuid[], integer, integer, text[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.get_broadcast_feed(uuid[], integer, integer, text[]) after rollback';
  END IF;
  o := to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.get_broadcast_feed(uuid[], integer, integer) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.get_broadcast_feed(uuid[], integer, integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.get_broadcast_feed(uuid[], integer, integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.get_broadcast_feed(uuid[], integer, integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.get_broadcast_feed(uuid[], integer, integer) after rollback';
  END IF;
  o := to_regprocedure('public.get_broadcast_feed(uuid[], integer)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.get_broadcast_feed(uuid[], integer) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.get_broadcast_feed(uuid[], integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.get_broadcast_feed(uuid[], integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.get_broadcast_feed(uuid[], integer) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.get_broadcast_feed(uuid[], integer) after rollback';
  END IF;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  IF missing > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- % named grant(s) that must be present after this rollback are absent. A rollback that restores nothing must still leave the surviving grants intact. Transaction aborted.', missing;
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED -- 0 object(s) granted, 3 object(s) checked, PUBLIC absent on all 3, named grantees intact.';
END $verify$;

COMMIT;
