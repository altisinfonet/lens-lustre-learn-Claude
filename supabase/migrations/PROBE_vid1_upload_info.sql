-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 video_upload_info (20261011_0001). READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   U1 · the function exists, is SECURITY DEFINER, STABLE, search_path = ''.
--   U2 · EXECUTE: authenticated yes; anon and PUBLIC no.
--   U3 · the column grants of video_versions are unchanged: API roles still
--        cannot read manifest_sha256 / total_bytes directly.
--   U4 · behaviour, as `authenticated` with a forged sub (only when a
--        not-deleted video exists): no session (NULL auth.uid()) → 0 rows;
--        another member → 0 rows; the owner → exactly 1 row for the current
--        version and 0 rows for any other version number.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits text := '';
  _p   record;
  _vid uuid;
  _ver integer;
  _own uuid;
  _n   bigint;
BEGIN
  IF to_regprocedure('public.video_upload_info(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-UI: U1 public.video_upload_info(uuid,integer) is not installed';
  END IF;
  SELECT p.prosecdef, p.provolatile, p.proconfig INTO _p FROM pg_proc p WHERE p.oid = 'public.video_upload_info(uuid,integer)'::regprocedure;
  IF NOT _p.prosecdef THEN hits := hits || E'\n  U1 not SECURITY DEFINER'; END IF;
  IF _p.provolatile <> 's' THEN hits := hits || E'\n  U1 not STABLE'; END IF;
  IF _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig)) THEN hits := hits || E'\n  U1 search_path is not empty'; END IF;

  IF NOT has_function_privilege('authenticated', 'public.video_upload_info(uuid,integer)', 'EXECUTE') THEN hits := hits || E'\n  U2 authenticated cannot execute'; END IF;
  IF has_function_privilege('anon', 'public.video_upload_info(uuid,integer)', 'EXECUTE') THEN hits := hits || E'\n  U2 anon can execute'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = 'public.video_upload_info(uuid,integer)'::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    hits := hits || E'\n  U2 PUBLIC can execute';
  END IF;

  IF has_column_privilege('authenticated', 'public.video_versions', 'manifest_sha256', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_versions', 'total_bytes', 'SELECT')
     OR has_column_privilege('anon', 'public.video_versions', 'manifest_sha256', 'SELECT') THEN
    hits := hits || E'\n  U3 an API role can read manifest_sha256 / total_bytes directly';
  END IF;

  -- U4 (behaviour). Forged subs are local to this transaction, which rolls back.
  SELECT v.id, v.current_version, v.owner_id INTO _vid, _ver, _own
    FROM public.videos v WHERE v.deleted_at IS NULL ORDER BY v.created_at DESC LIMIT 1;
  IF _vid IS NOT NULL THEN
    -- auth.uid() reads request.jwt.claim.sub first, then request.jwt.claims->>'sub':
    -- clear the first so only the forged claims decide.
    PERFORM set_config('request.jwt.claim.sub', '', true);

    -- a. no session at all (NULL auth.uid()) → zero rows
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.video_upload_info(_vid, _ver);
    IF _n <> 0 THEN hits := hits || format(E'\n  U4 a NULL auth.uid() got %s row(s)', _n); END IF;
    RESET ROLE;

    -- b. another member → zero rows
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.video_upload_info(_vid, _ver);
    IF _n <> 0 THEN hits := hits || format(E'\n  U4 a stranger got %s row(s) for someone else''s video', _n); END IF;
    RESET ROLE;

    -- c. the owner: current version → one row; any other version number → zero rows
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _own::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.video_upload_info(_vid, _ver);
    IF _n <> 1 THEN hits := hits || format(E'\n  U4 the owner got %s row(s) for their own current version (expected 1)', _n); END IF;
    SELECT count(*) INTO _n FROM public.video_upload_info(_vid, _ver + 1);
    IF _n <> 0 THEN hits := hits || format(E'\n  U4 the owner got %s row(s) for a non-current version', _n); END IF;
    RESET ROLE;
  END IF;

  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-UI:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-UI: owner-only, current version; no-session 0, stranger 0, owner 1, owner non-current 0 (%)',
    CASE WHEN _vid IS NULL THEN 'U4 not exercised — no video on this lane' ELSE 'U4 exercised on a live video row' END;
END
$probe$;
ROLLBACK;
