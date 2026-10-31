-- ==========================================================================
-- ROLLBACK for 20260917140000_p32_media_pipeline_acl_reassertion.sql
-- P32 — the media write path
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
--   GRANT EXECUTE ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text) TO PUBLIC, anon,...
--   GRANT EXECUTE ON FUNCTION public.media_mark_ready(uuid, jsonb) TO PUBLIC, anon, authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.media_mark_verified(uuid) TO PUBLIC, anon, authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.media_migrate_post(uuid, uuid, jsonb) TO PUBLIC, anon, authenticated, serv...
--   GRANT EXECUTE ON FUNCTION public.media_quarantine(uuid, text) TO PUBLIC, anon, authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.post_attach_media(uuid, uuid[]) TO PUBLIC, anon, authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[])...
--   GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid) TO PUBLIC, anon, authenticated, service_role;
--
-- --------------------------------------------------------------------------
-- WHAT THE APPLY ACTUALLY REMOVED -- read from the apply file, statement by
-- statement, never from the old rollback body, which is the thing being corrected.
--
--   public.media_begin_upload(bytea, integer, integer, bigint, text)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: authenticated, service_role
--       -> RESTORE   : anon, authenticated
--   public.media_mark_ready(uuid, jsonb)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: service_role
--       -> RESTORE   : anon, authenticated
--   public.media_mark_verified(uuid)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: service_role
--       -> RESTORE   : anon, authenticated
--   public.media_migrate_post(uuid, uuid, jsonb)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: service_role
--       -> RESTORE   : anon, authenticated
--   public.media_quarantine(uuid, text)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: service_role
--       -> RESTORE   : anon, authenticated
--   public.post_attach_media(uuid, uuid[])
--       REVOKE from : public, anon, authenticated
--       then GRANT to: service_role
--       -> RESTORE   : anon, authenticated
--   public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[])
--       REVOKE from : public, anon, authenticated
--       then GRANT to: authenticated, service_role
--       -> RESTORE   : anon, authenticated
--   public.publish_post_draft(uuid)
--       REVOKE from : public, anon, authenticated
--       then GRANT to: authenticated, service_role
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
--     \i supabase/rollback/20260917140000_p32_media_pipeline_acl_reassertion_ROLLBACK.sql
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

GRANT EXECUTE ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_mark_ready(uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_mark_verified(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_migrate_post(uuid, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_quarantine(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_attach_media(uuid, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid) TO anon, authenticated;

DO $verify$
DECLARE bad int := 0; missing int := 0; o oid;
BEGIN
  o := to_regprocedure('public.media_begin_upload(bytea, integer, integer, bigint, text)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.media_begin_upload(bytea, integer, integer, bigint, text) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.media_begin_upload(bytea, integer, integer, bigint, text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.media_begin_upload(bytea, integer, integer, bigint, text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.media_begin_upload(bytea, integer, integer, bigint, text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.media_begin_upload(bytea, integer, integer, bigint, text) after rollback';
  END IF;
  o := to_regprocedure('public.media_mark_ready(uuid, jsonb)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.media_mark_ready(uuid, jsonb) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.media_mark_ready(uuid, jsonb) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.media_mark_ready(uuid, jsonb) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.media_mark_ready(uuid, jsonb) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.media_mark_ready(uuid, jsonb) after rollback';
  END IF;
  o := to_regprocedure('public.media_mark_verified(uuid)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.media_mark_verified(uuid) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.media_mark_verified(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.media_mark_verified(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.media_mark_verified(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.media_mark_verified(uuid) after rollback';
  END IF;
  o := to_regprocedure('public.media_migrate_post(uuid, uuid, jsonb)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.media_migrate_post(uuid, uuid, jsonb) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.media_migrate_post(uuid, uuid, jsonb) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.media_migrate_post(uuid, uuid, jsonb) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.media_migrate_post(uuid, uuid, jsonb) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.media_migrate_post(uuid, uuid, jsonb) after rollback';
  END IF;
  o := to_regprocedure('public.media_quarantine(uuid, text)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.media_quarantine(uuid, text) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.media_quarantine(uuid, text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.media_quarantine(uuid, text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.media_quarantine(uuid, text) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.media_quarantine(uuid, text) after rollback';
  END IF;
  o := to_regprocedure('public.post_attach_media(uuid, uuid[])')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.post_attach_media(uuid, uuid[]) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.post_attach_media(uuid, uuid[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.post_attach_media(uuid, uuid[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.post_attach_media(uuid, uuid[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.post_attach_media(uuid, uuid[]) after rollback';
  END IF;
  o := to_regprocedure('public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[])')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) after rollback';
  END IF;
  o := to_regprocedure('public.publish_post_draft(uuid)')::oid;
  IF o IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- public.publish_post_draft(uuid) does not exist on this lane.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    bad := bad + 1;
    RAISE WARNING 'PUBLIC holds EXECUTE on public.publish_post_draft(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'anon=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named anon grant absent on public.publish_post_draft(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'authenticated=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named authenticated grant absent on public.publish_post_draft(uuid) after rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proacl) a
                  WHERE p.oid = o AND a::text LIKE 'service_role=%') THEN
    missing := missing + 1;
    RAISE WARNING 'named service_role grant absent on public.publish_post_draft(uuid) after rollback';
  END IF;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  IF missing > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED -- % named grant(s) that must be present after this rollback are absent. A rollback that restores nothing must still leave the surviving grants intact. Transaction aborted.', missing;
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED -- 8 object(s) granted, 8 object(s) checked, PUBLIC absent on all 8, named grantees intact.';
END $verify$;

COMMIT;
