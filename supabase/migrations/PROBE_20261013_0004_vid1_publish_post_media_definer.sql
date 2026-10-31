-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261013_0004 — video_publish_post() reads post_media only through a
-- SECURITY DEFINER helper scoped to the caller's own post; anon/authenticated
-- hold no privilege on post_media.
-- Lanes: staging and production (the expected state is the same on both).
-- READ-ONLY (BEGIN READ ONLY … ROLLBACK). Raises, and so fails the dispatch, on
-- any hit. Prints counts and booleans only — never an id.
--
--   G1 · post_media: for anon and authenticated, each of SELECT/INSERT/UPDATE/
--        DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN is false by
--        has_table_privilege (effect, not statement success — F-62), no
--        column-level privilege, no PUBLIC entry; the ACL equals production's
--        {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}.
--   G2 · video_publish_own_post_has_media(uuid): SECURITY DEFINER, STABLE, sql,
--        search_path '', the reviewed body (md5) — whose WHERE ties the post to
--        (SELECT auth.uid()); EXECUTE for authenticated and service_role only.
--   G3 · video_publish_post(): SECURITY INVOKER, search_path '', the reviewed
--        body (md5), no direct post_media read, asks the helper; EXECUTE for
--        authenticated, not anon, not PUBLIC.
--   G4 · callers: no SECURITY INVOKER function, view or (non-post_media,
--        non-media_objects) policy names post_media; it is in no publication;
--        anon/authenticated hold no privilege on media_objects.
--   G5 · BY EFFECT, as the API roles (SET LOCAL ROLE, rolled back):
--        authenticated: SELECT on post_media → 42501;
--        the helper, asked about a post that has post_media rows —
--          by a member who is not its author → false   (cross-member; a real
--             second author on the lane when there is one, else a fresh uuid)
--          by its author                     → true
--          with no session                   → false;
--        anon: the helper → 42501.
--        A lane with no post_media row at all FAILS G5: a cross-member check
--        with nothing to leak would pass vacuously (it cannot fail).
-- Expected result: FAILS on staging before 20261013_0004 (helper missing,
-- authenticated still holds SELECT on post_media, video_publish_post still
-- reads post_media as the member); PASSES after it, on staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  _fn     regprocedure := to_regprocedure('public.video_publish_post(uuid,text,text,text[],text)');
  _h      regprocedure := to_regprocedure('public.video_publish_own_post_has_media(uuid)');
  _p      record;
  _r      text;
  _pv     text;
  _acl    text;
  _bad    text := '';
  _post   uuid;
  _author uuid;
  _other  uuid;
  _ans    boolean;
BEGIN
  -- G0 · lane guard.
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED 20261013_0004 — p32.lane reads %. Dispatch apply-migration.yml with a target.',
      coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
  IF _fn IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-PM: video_publish_post() is missing (apply 20261011_0003, then 20261013_0004)';
  END IF;
  -- A missing helper is recorded and every check that does not need it still
  -- runs, so a reading taken before the apply shows the whole pre-state.
  IF _h IS NULL THEN
    _bad := _bad || E'\n  G2 video_publish_own_post_has_media(uuid) is missing';
  END IF;

  -- G1 · post_media privileges.
  FOREACH _r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH _pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      IF has_table_privilege(_r, 'public.post_media', _pv) THEN
        _bad := _bad || E'\n  G1 ' || _r || ' holds ' || _pv || ' on post_media';
      END IF;
    END LOOP;
    FOREACH _pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege(_r, 'public.post_media', _pv) THEN
        _bad := _bad || E'\n  G1 ' || _r || ' holds column ' || _pv || ' on post_media';
      END IF;
    END LOOP;
  END LOOP;
  SELECT string_agg(x, ',' ORDER BY x COLLATE "C") INTO _acl
    FROM (SELECT concat_ws('|', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                           a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
            FROM pg_class c, LATERAL aclexplode(c.relacl) a
           WHERE c.oid = 'public.post_media'::regclass) s;
  IF _acl IS DISTINCT FROM 'postgres|DELETE|postgres|false,postgres|INSERT|postgres|false,postgres|MAINTAIN|postgres|false,postgres|REFERENCES|postgres|false,postgres|SELECT|postgres|false,postgres|TRIGGER|postgres|false,postgres|TRUNCATE|postgres|false,postgres|UPDATE|postgres|false,service_role|DELETE|postgres|false,service_role|INSERT|postgres|false,service_role|MAINTAIN|postgres|false,service_role|REFERENCES|postgres|false,service_role|SELECT|postgres|false,service_role|TRIGGER|postgres|false,service_role|TRUNCATE|postgres|false,service_role|UPDATE|postgres|false' THEN
    _bad := _bad || E'\n  G1 post_media ACL is not production''s: ' || coalesce(_acl, '(default)');
  END IF;

  -- G2 · the helper.
  IF _h IS NOT NULL THEN
    SELECT md5(prosrc) AS m, prosecdef, provolatile, proconfig, prorettype::regtype::text AS ret,
           (SELECT lanname FROM pg_language WHERE oid = prolang) AS lang
      INTO _p FROM pg_proc WHERE oid = _h;
    IF NOT _p.prosecdef OR _p.provolatile <> 's' OR _p.lang <> 'sql' OR _p.ret <> 'boolean'
       OR _p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
       OR _p.m IS DISTINCT FROM '8fabf828db14522ad56ca5d7ae6bc63c' THEN
      _bad := _bad || E'\n  G2 helper is not the reviewed SECURITY DEFINER STABLE sql body (md5 ' || coalesce(_p.m, '?') || ')';
    END IF;
    IF NOT has_function_privilege('authenticated', _h, 'EXECUTE') OR NOT has_function_privilege('service_role', _h, 'EXECUTE')
       OR has_function_privilege('anon', _h, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc, aclexplode(coalesce(proacl, acldefault('f', proowner))) a
                   WHERE oid = _h AND a.grantee = 0) THEN
      _bad := _bad || E'\n  G2 helper EXECUTE is not exactly authenticated + service_role';
    END IF;
  END IF;

  -- G3 · video_publish_post().
  SELECT md5(prosrc) AS m, prosecdef, proconfig, prosrc INTO _p FROM pg_proc WHERE oid = _fn;
  IF _p.prosecdef OR _p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
     OR _p.m IS DISTINCT FROM '243e37c6c8bd8403b19d43ad4c57220d'
     OR position('FROM public.post_media' IN _p.prosrc) > 0
     OR position('public.video_publish_own_post_has_media(_post)' IN _p.prosrc) = 0 THEN
    _bad := _bad || E'\n  G3 video_publish_post is not the reviewed SECURITY INVOKER body (md5 ' || coalesce(_p.m, '?') || ')';
  END IF;
  IF NOT has_function_privilege('authenticated', _fn, 'EXECUTE') OR has_function_privilege('anon', _fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc, aclexplode(coalesce(proacl, acldefault('f', proowner))) a
                 WHERE oid = _fn AND a.grantee = 0) THEN
    _bad := _bad || E'\n  G3 video_publish_post EXECUTE is not authenticated-only (of the API roles)';
  END IF;

  -- G4 · callers.
  SELECT string_agg(x, '; ') INTO _r FROM (
      SELECT 'SECURITY INVOKER function ' || p.oid::regprocedure::text AS x
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE NOT p.prosecdef AND p.prosrc ~* '(^|[^a-z0-9_])post_media([^a-z0-9_]|$)'
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      UNION ALL
      SELECT 'view ' || c.oid::regclass::text
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND pg_get_viewdef(c.oid) ~* '(^|[^a-z0-9_])post_media([^a-z0-9_]|$)'
      UNION ALL
      SELECT 'policy ' || pol.polname || ' on ' || pol.polrelid::regclass::text
        FROM pg_policy pol
       WHERE pol.polrelid NOT IN ('public.post_media'::regclass, 'public.media_objects'::regclass)
         AND (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ~* '(^|[^a-z0-9_])post_media([^a-z0-9_]|$)'
              OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~* '(^|[^a-z0-9_])post_media([^a-z0-9_]|$)')
      UNION ALL
      SELECT 'publication ' || pubname FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'post_media'
      UNION ALL
      SELECT 'media_objects privilege for ' || r
        FROM unnest(ARRAY['anon', 'authenticated']) r
       WHERE has_table_privilege(r, 'public.media_objects', 'SELECT')
          OR has_table_privilege(r, 'public.media_objects', 'UPDATE')
          OR has_table_privilege(r, 'public.media_objects', 'DELETE')
    ) s;
  IF _r IS NOT NULL THEN
    _bad := _bad || E'\n  G4 a caller may read post_media as the member: ' || _r;
  END IF;

  -- G5 · by effect, as the API roles. A post that has post_media rows, and its
  -- author, are read here as the owner, before any role switch.
  SELECT p.id, p.user_id INTO _post, _author
    FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
   ORDER BY p.created_at DESC, p.id LIMIT 1;
  IF _post IS NULL THEN
    _bad := _bad || E'\n  G5 no post with post_media rows on this lane — the cross-member check would be vacuous';
  ELSE
    -- the "other member": a real second author when the lane has one.
    SELECT p.user_id INTO _other FROM public.posts p
     WHERE p.user_id <> _author ORDER BY p.created_at DESC, p.id LIMIT 1;
    _other := coalesce(_other, gen_random_uuid());
    SET LOCAL ROLE authenticated;
    -- a member who is not the author
    PERFORM set_config('request.jwt.claim.sub', _other::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _other, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM 1 FROM public.post_media LIMIT 1;
      _bad := _bad || E'\n  G5 authenticated can SELECT post_media';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    IF _h IS NOT NULL THEN
      _ans := public.video_publish_own_post_has_media(_post);
      IF _ans IS DISTINCT FROM false THEN
        _bad := _bad || E'\n  G5 cross-member: the helper answered ' || coalesce(_ans::text, 'NULL') || ' for another member''s post';
      END IF;
      -- its author
      PERFORM set_config('request.jwt.claim.sub', _author::text, true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', _author, 'role', 'authenticated')::text, true);
      _ans := public.video_publish_own_post_has_media(_post);
      IF _ans IS DISTINCT FROM true THEN
        _bad := _bad || E'\n  G5 owner: the helper answered ' || coalesce(_ans::text, 'NULL') || ' for the author''s own post';
      END IF;
      -- no session
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claims', '', true);
      _ans := public.video_publish_own_post_has_media(_post);
      IF _ans IS DISTINCT FROM false THEN
        _bad := _bad || E'\n  G5 no session: the helper answered ' || coalesce(_ans::text, 'NULL');
      END IF;
      RESET ROLE;
      SET LOCAL ROLE anon;
      BEGIN
        _ans := public.video_publish_own_post_has_media(_post);
        _bad := _bad || E'\n  G5 anon can execute the helper';
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;
    END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-PM 20261013_0004 (lane %):%', current_setting('p32.lane', true), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-PM 20261013_0004 (lane %): post_media closed to anon/authenticated (= production); helper DEFINER + own-post WHERE (cross-member false, owner true, no session false, anon refused); video_publish_post INVOKER without a direct post_media read',
    current_setting('p32.lane', true);
END
$probe$;
ROLLBACK;
