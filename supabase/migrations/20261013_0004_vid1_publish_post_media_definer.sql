-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261013_0004 — video_publish_post() no longer reads post_media as
-- the member; staging's last post_media keep (authenticated SELECT) goes.
-- Lanes: staging and production. D1 (Database & Runtime).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (independent review of PR #424, 2026-10-13). public.video_publish_post()
-- (20261011_0003) is SECURITY INVOKER. In its replay branch it ran
--     EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = _post)
-- as the member. On production the role authenticated holds NO privilege on
-- post_media (relacl {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres},
-- read-only collector 2026-10-13 06:51Z), and it must not get one
-- (src/hooks/feed/useFeedQuery.ts:250, src/lib/media/postMediaRead.ts:7).
-- PostgreSQL checks the privileges of every relation in a statement when the
-- statement starts, so that whole IF condition raises 42501 "permission denied
-- for table post_media" — even when its first half (image_urls) is already
-- true. Staging hid this: 20261013_0001 kept authenticated SELECT on post_media
-- for this one function (keep 6 of 6).
--
-- WHICH CALLS FAIL ON PRODUCTION WITHOUT THIS FILE: a replay (same member, same
-- idempotency key) that finds that member's post NOT linked to a video — a post
-- left by the older two-step publish, or a photo post holding the same key.
-- It raised 42501 instead of linking the video / refusing with VID-PUB-003.
-- A first publish, and a replay of a publish that already linked, never reached
-- the statement. Proven on a production-shaped fixture (CI: d1-vid1-publish-fixture.yml).
--
-- EVERY TABLE ACCESS video_publish_post() MAKES AS THE MEMBER (20261011_0003 body):
--   posts        SELECT  replay lookup (own user_id + key); image_urls/image_url check
--                INSERT  the new post
--   post_videos  SELECT  is this post already linked?
--                INSERT  the link
--   post_media   SELECT  "does this post carry photographs?"   ← the only one
--                        the member has no privilege for on production; moved
--                        behind the helper below. Nothing writes post_media.
-- posts: authenticated holds SELECT/INSERT on both lanes (production relacl
-- authenticated=arwdm); its RLS lets a member read their own posts
-- (can_view_post: viewer = author). post_videos: staging-only (VID-1), the
-- member's grants arrive with VID-1 on production. The triggers those inserts
-- fire are SECURITY DEFINER except enforce_post_categories(), which reads no
-- post_media.
--
-- WHAT
--   1. public.video_publish_own_post_has_media(_post_id uuid) RETURNS boolean.
--      SECURITY DEFINER (it reads post_media as the owner, so RLS does not
--      apply — its WHERE clause is the whole control):
--          pm.post_id = _post_id AND p.user_id = (SELECT auth.uid())
--      It answers only about the CALLER'S OWN post: false for anyone else's,
--      false with no session, false for NULL. A member can call it directly
--      through the API and learn nothing they cannot already read about their
--      own post. STABLE, LANGUAGE sql, SET search_path = ''. EXECUTE:
--      authenticated + service_role only — production's convention (54 of 54
--      functions callable by authenticated but not anon also grant
--      service_role); never PUBLIC, never anon.
--   2. public.video_publish_post(): the same body with ONE change — the
--      post_media EXISTS becomes a call to the helper. Still SECURITY INVOKER,
--      so the posts/post_videos policies and the link guard apply unchanged.
--      CREATE OR REPLACE keeps its ACL (authenticated + service_role).
--   3. REVOKE ALL ON public.post_media FROM PUBLIC, anon, authenticated.
--      Staging: removes the last post_media keep, so staging's post_media ACL
--      equals production's exactly. Production: nothing to remove. A REVOKE can
--      succeed and change nothing (F-62), so POST-001 asserts the EFFECT.
--
-- CALLERS OF authenticated SELECT ON post_media, checked before revoking
-- (source: origin/staging b93444b5; staging: catalog, read-only, 2026-10-13
-- 11:26Z; production: collector dump supabase-20261013-121953, files only):
--   * src/** and functions/**: no .from("post_media"), no embedded post_media(...)
--     select; every client read goes through post_media_for() (DEFINER).
--   * supabase/functions/**: five .from("post_media") calls, in
--     detect-orphan-files, migrate-post-media and backfill-media-objects —
--     every one on the service-role client.
--   * functions whose body names post_media: the same 8 on both lanes, all
--     SECURITY DEFINER; plus, on staging, video_publish_post — the only
--     SECURITY INVOKER one (fixed here).
--   * RLS policies naming post_media: post_media's own three, and
--     media_objects_select — anon/authenticated hold no privilege on
--     media_objects on either lane, so that subquery never runs as them.
--   * views / materialized views: none. Publications: none. Cron: all 18
--     production jobs run as postgres and none names post_media. The
--     posts → post_media ON DELETE CASCADE runs as the table owner.
--   * NOT re-read for this revision: staging's pg_stat_statements. An earlier
--     reading (2026-10-13, the first preparer of this unit) found every
--     anon/authenticated statement naming post_media to be a post_media_for()
--     RPC call; treat that as relayed, not verified.
--   PRE-005 re-reads the catalog half of this at apply time and refuses if a
--   new caller has appeared since.
--
-- ORDER. Staging: apply now. Production: when VID-1 is promoted, directly after
-- 20261011_0003 (PRE-002 refuses until 0003's body is there).
-- 20261013_0001: its PROBE's post_media row is updated in this PR (five keeps
-- remain); its ROLLBACK refuses once this file is applied (its RB-PRE-001
-- fingerprint includes post_media) — roll this file back first.
--
-- RE-RUN: refused by PRE-001 (the helper exists). After the rollback the
-- pre-state is back and this file can be applied again.
-- ROLLBACK: supabase/rollback/20261013_0004_vid1_publish_post_media_definer_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261013_0004_vid1_publish_post_media_definer.sql
-- OBJECTS (reservation): public.video_publish_own_post_has_media(uuid) (new);
--   public.video_publish_post(uuid,text,text,text[],text) (body only);
--   public.post_media (ACL only).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _lane text := current_setting('p32.lane', true);
  _fn   regprocedure := to_regprocedure('public.video_publish_post(uuid,text,text,text[],text)');
  _p    record;
  _acl  text;
  _want text;
  _bad  text;
BEGIN
  -- PRE-001 · the helper does not exist yet (refuses a re-run).
  IF to_regprocedure('public.video_publish_own_post_has_media(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID-PM-PRE-001: public.video_publish_own_post_has_media(uuid) already exists — this file has run; read it';
  END IF;

  -- PRE-002 · video_publish_post() is exactly the 20261011_0003 function, owned
  -- by the role running this file.
  IF _fn IS NULL THEN
    RAISE EXCEPTION 'VID-PM-PRE-002: public.video_publish_post() is missing — apply 20261011_0003 first';
  END IF;
  SELECT md5(prosrc) AS m, prosecdef, proconfig, pg_get_userbyid(proowner) AS owner INTO _p FROM pg_proc WHERE oid = _fn;
  IF _p.m IS DISTINCT FROM '2f326237f4df8c1d33b647dfd4ab81bc' OR _p.prosecdef
     OR _p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR _p.owner <> current_user THEN
    RAISE EXCEPTION 'VID-PM-PRE-002: video_publish_post() is not the 20261011_0003 SECURITY INVOKER body owned by % (md5 %) — read it before replacing',
      current_user, _p.m;
  END IF;

  -- PRE-003 · post_media is owned by the role running this file (so the REVOKE
  -- acts as the owner — F-62) and its ACL is exactly this lane's known state.
  IF to_regclass('public.post_media') IS NULL THEN
    RAISE EXCEPTION 'VID-PM-PRE-003: public.post_media is missing';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.post_media'::regclass) <> current_user THEN
    RAISE EXCEPTION 'VID-PM-PRE-003: public.post_media is not owned by % — a REVOKE would not act as the owner', current_user;
  END IF;
  SELECT string_agg(x, ',' ORDER BY x COLLATE "C") INTO _acl
    FROM (SELECT concat_ws('|', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                           a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
            FROM pg_class c, LATERAL aclexplode(c.relacl) a
           WHERE c.oid = 'public.post_media'::regclass) s;
  -- staging: production's set + authenticated SELECT (20261013_0001 keep 6);
  -- production: the collector's 2026-10-13 reading.
  _want := CASE _lane
    WHEN 'staging' THEN
      'authenticated|SELECT|postgres|false,postgres|DELETE|postgres|false,postgres|INSERT|postgres|false,postgres|MAINTAIN|postgres|false,postgres|REFERENCES|postgres|false,postgres|SELECT|postgres|false,postgres|TRIGGER|postgres|false,postgres|TRUNCATE|postgres|false,postgres|UPDATE|postgres|false,service_role|DELETE|postgres|false,service_role|INSERT|postgres|false,service_role|MAINTAIN|postgres|false,service_role|REFERENCES|postgres|false,service_role|SELECT|postgres|false,service_role|TRIGGER|postgres|false,service_role|TRUNCATE|postgres|false,service_role|UPDATE|postgres|false'
    ELSE
      'postgres|DELETE|postgres|false,postgres|INSERT|postgres|false,postgres|MAINTAIN|postgres|false,postgres|REFERENCES|postgres|false,postgres|SELECT|postgres|false,postgres|TRIGGER|postgres|false,postgres|TRUNCATE|postgres|false,postgres|UPDATE|postgres|false,service_role|DELETE|postgres|false,service_role|INSERT|postgres|false,service_role|MAINTAIN|postgres|false,service_role|REFERENCES|postgres|false,service_role|SELECT|postgres|false,service_role|TRIGGER|postgres|false,service_role|TRUNCATE|postgres|false,service_role|UPDATE|postgres|false'
  END;
  IF _acl IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'VID-PM-PRE-003: post_media ACL on lane % is not the known state — refusing (read %)', _lane, coalesce(_acl, '(default)');
  END IF;

  -- PRE-004 · no column-level grant on post_media (a table REVOKE would leave it).
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.post_media'::regclass AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'VID-PM-PRE-004: post_media has column-level grants — read them first';
  END IF;

  -- PRE-005 · nothing else reads post_media with the caller's privileges.
  SELECT string_agg(x, '; ') INTO _bad FROM (
      SELECT 'SECURITY INVOKER function ' || p.oid::regprocedure::text AS x
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE NOT p.prosecdef AND p.prosrc ~* '(^|[^a-z0-9_])post_media([^a-z0-9_]|$)'
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND p.oid <> _fn
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
      SELECT 'media_objects privilege for ' || r || ' (its policy subqueries post_media as the caller)'
        FROM unnest(ARRAY['anon', 'authenticated']) r
       WHERE has_table_privilege(r, 'public.media_objects', 'SELECT')
          OR has_table_privilege(r, 'public.media_objects', 'UPDATE')
          OR has_table_privilege(r, 'public.media_objects', 'DELETE')
    ) s;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'VID-PM-PRE-005: another caller may read post_media as the member: % — inspect before revoking', _bad;
  END IF;

  -- PRE-006 · the reads video_publish_post() keeps as the member are granted on
  -- this lane, so it stays callable once post_media is closed.
  IF NOT (has_table_privilege('authenticated', 'public.posts', 'SELECT')
          AND has_table_privilege('authenticated', 'public.posts', 'INSERT')
          AND has_table_privilege('authenticated', 'public.post_videos', 'SELECT')
          AND has_table_privilege('authenticated', 'public.post_videos', 'INSERT')) THEN
    RAISE EXCEPTION 'VID-PM-PRE-006: authenticated lacks SELECT/INSERT on posts or post_videos';
  END IF;

  -- PRE-007 · POST-005 switches to the API role to test by effect.
  IF NOT pg_has_role(current_user, 'authenticated', 'SET') THEN
    RAISE EXCEPTION 'VID-PM-PRE-007: % cannot SET ROLE authenticated (POST-005 tests as that role)', current_user;
  END IF;
END
$preconditions$;

-- ── 1. the helper: post_media for the caller's own post, nothing else ───────
CREATE FUNCTION public.video_publish_own_post_has_media(_post_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  -- SECURITY DEFINER: RLS does not apply here. The WHERE clause is the whole
  -- control: only a post whose author is the caller can answer true.
  SELECT EXISTS (
    SELECT 1
      FROM public.post_media pm
      JOIN public.posts p ON p.id = pm.post_id
     WHERE pm.post_id = _post_id
       AND p.user_id = (SELECT auth.uid())
  );
$fn$;

REVOKE ALL ON FUNCTION public.video_publish_own_post_has_media(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_publish_own_post_has_media(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.video_publish_own_post_has_media(uuid) IS
  'VID-1 20261013_0004: true when the CALLER''S OWN post has post_media rows; false for any other post. SECURITY DEFINER — the WHERE on auth.uid() is the control. Used by video_publish_post().';

-- ── 2. video_publish_post(): the post_media read goes through the helper ────
CREATE OR REPLACE FUNCTION public.video_publish_post(_video_id uuid, _content text, _privacy text,
                                                     _categories text[], _idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $fn$
DECLARE
  _uid    uuid := (SELECT auth.uid());
  _post   uuid;
  _linked uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'VID-PUB-001: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _video_id IS NULL THEN
    RAISE EXCEPTION 'VID-PUB-002: video_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'VID-PUB-002: idempotency_key must be 8–200 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- One publish per (member, key) at a time: a concurrent second call waits
  -- here and then takes the replay path below instead of failing with 23505
  -- (independent review C1).
  PERFORM pg_advisory_xact_lock(hashtextextended('video_publish_post:' || _uid::text || ':' || _idempotency_key, 0));

  -- A replay of a publish that already landed: return that post. A post left
  -- unlinked by the older two-step publish is linked now — but never a photo
  -- post: post_publish_with_media sets keys too, and a video never joins a
  -- post that already carries photographs (independent review C2).
  SELECT p.id INTO _post FROM public.posts p
   WHERE p.user_id = _uid AND p.idempotency_key = _idempotency_key;
  IF _post IS NOT NULL THEN
    SELECT pv.video_id INTO _linked FROM public.post_videos pv WHERE pv.post_id = _post;
    IF _linked IS NULL THEN
      -- Photographs registered in the media tables are asked about through
      -- video_publish_own_post_has_media() (SECURITY DEFINER, own post only):
      -- the member holds no privilege on those tables (20261013_0004).
      IF EXISTS (SELECT 1 FROM public.posts p
                  WHERE p.id = _post
                    AND (COALESCE(cardinality(p.image_urls), 0) > 0 OR COALESCE(p.image_url, '') <> ''))
         OR public.video_publish_own_post_has_media(_post) THEN
        RAISE EXCEPTION 'VID-PUB-003: this publish key belongs to a photo post' USING ERRCODE = 'unique_violation';
      END IF;
      INSERT INTO public.post_videos (post_id, video_id) VALUES (_post, _video_id);
    ELSIF _linked <> _video_id THEN
      RAISE EXCEPTION 'VID-PUB-003: this publish key already belongs to another video' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN _post;
  END IF;

  -- Read by detect_duplicate_post() for this one insert only (transaction-local).
  PERFORM set_config('vid1.publishing_video', _video_id::text, true);
  INSERT INTO public.posts (user_id, content, privacy, categories, idempotency_key)
  VALUES (_uid, coalesce(_content, ''), coalesce(_privacy, 'public'), _categories, _idempotency_key)
  RETURNING id INTO _post;
  PERFORM set_config('vid1.publishing_video', '', true);

  -- The link guard and RLS refuse anything wrong here — and the post above
  -- goes with it: one transaction.
  INSERT INTO public.post_videos (post_id, video_id) VALUES (_post, _video_id);
  RETURN _post;
END;
$fn$;

COMMENT ON FUNCTION public.video_publish_post(uuid, text, text, text[], text) IS
  'VID-1 20261011_0003 + 20261013_0004: post + post_videos link in one transaction, as the member (SECURITY INVOKER). Idempotent by key. Reads post_media only through video_publish_own_post_has_media().';

-- ── 3. post_media: no privilege for the API roles (= production) ────────────
REVOKE ALL ON TABLE public.post_media FROM PUBLIC, anon, authenticated;

DO $postconditions$
DECLARE
  _fn   regprocedure := 'public.video_publish_post(uuid,text,text,text[],text)'::regprocedure;
  _h    regprocedure := 'public.video_publish_own_post_has_media(uuid)'::regprocedure;
  _p    record;
  _r    text;
  _pv   text;
  _acl  text;
  _bad  text := '';
  _uid  uuid := gen_random_uuid();
  _any  uuid;
BEGIN
  -- POST-001 · post_media: anon and authenticated hold nothing, by effect; no
  -- PUBLIC entry; the ACL is production's exactly.
  FOREACH _r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH _pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      IF has_table_privilege(_r, 'public.post_media', _pv) THEN
        _bad := _bad || E'\n  POST-001 ' || _r || ' still holds ' || _pv || ' on post_media';
      END IF;
    END LOOP;
    FOREACH _pv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege(_r, 'public.post_media', _pv) THEN
        _bad := _bad || E'\n  POST-001 ' || _r || ' holds column ' || _pv || ' on post_media';
      END IF;
    END LOOP;
  END LOOP;
  SELECT string_agg(x, ',' ORDER BY x COLLATE "C") INTO _acl
    FROM (SELECT concat_ws('|', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                           a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
            FROM pg_class c, LATERAL aclexplode(c.relacl) a
           WHERE c.oid = 'public.post_media'::regclass) s;
  IF _acl IS DISTINCT FROM 'postgres|DELETE|postgres|false,postgres|INSERT|postgres|false,postgres|MAINTAIN|postgres|false,postgres|REFERENCES|postgres|false,postgres|SELECT|postgres|false,postgres|TRIGGER|postgres|false,postgres|TRUNCATE|postgres|false,postgres|UPDATE|postgres|false,service_role|DELETE|postgres|false,service_role|INSERT|postgres|false,service_role|MAINTAIN|postgres|false,service_role|REFERENCES|postgres|false,service_role|SELECT|postgres|false,service_role|TRIGGER|postgres|false,service_role|TRUNCATE|postgres|false,service_role|UPDATE|postgres|false' THEN
    _bad := _bad || E'\n  POST-001 post_media ACL is not production''s: ' || coalesce(_acl, '(default)');
  END IF;

  -- POST-002 · the helper: DEFINER, STABLE, sql, search_path '', the reviewed
  -- body, owned by the runner; EXECUTE for authenticated + service_role only.
  SELECT md5(prosrc) AS m, prosecdef, provolatile, proconfig, prorettype::regtype::text AS ret,
         (SELECT lanname FROM pg_language WHERE oid = prolang) AS lang, pg_get_userbyid(proowner) AS owner
    INTO _p FROM pg_proc WHERE oid = _h;
  IF NOT _p.prosecdef OR _p.provolatile <> 's' OR _p.lang <> 'sql' OR _p.ret <> 'boolean'
     OR _p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR _p.owner <> current_user
     OR _p.m IS DISTINCT FROM '8fabf828db14522ad56ca5d7ae6bc63c' THEN
    _bad := _bad || E'\n  POST-002 helper attributes/body differ (md5 ' || coalesce(_p.m, 'missing') || ')';
  END IF;
  IF NOT has_function_privilege('authenticated', _h, 'EXECUTE') OR NOT has_function_privilege('service_role', _h, 'EXECUTE')
     OR has_function_privilege('anon', _h, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc, aclexplode(coalesce(proacl, acldefault('f', proowner))) a
                 WHERE oid = _h AND a.grantee = 0) THEN
    _bad := _bad || E'\n  POST-002 helper EXECUTE is not exactly authenticated + service_role';
  END IF;

  -- POST-003 · video_publish_post(): still SECURITY INVOKER, the reviewed body,
  -- no direct post_media read, asks the helper; ACL unchanged.
  SELECT md5(prosrc) AS m, prosecdef, proconfig, prosrc INTO _p FROM pg_proc WHERE oid = _fn;
  IF _p.prosecdef OR _p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
     OR _p.m IS DISTINCT FROM '243e37c6c8bd8403b19d43ad4c57220d'
     OR position('FROM public.post_media' IN _p.prosrc) > 0
     OR position('public.video_publish_own_post_has_media(_post)' IN _p.prosrc) = 0 THEN
    _bad := _bad || E'\n  POST-003 video_publish_post body/attributes differ (md5 ' || coalesce(_p.m, 'missing') || ')';
  END IF;
  IF NOT has_function_privilege('authenticated', _fn, 'EXECUTE') OR has_function_privilege('anon', _fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc, aclexplode(coalesce(proacl, acldefault('f', proowner))) a
                 WHERE oid = _fn AND a.grantee = 0) THEN
    _bad := _bad || E'\n  POST-003 video_publish_post EXECUTE changed';
  END IF;

  -- POST-004 · no SECURITY INVOKER function anywhere still names post_media.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE NOT p.prosecdef AND p.prosrc ~* '(^|[^a-z0-9_])post_media([^a-z0-9_]|$)'
     AND n.nspname NOT IN ('pg_catalog', 'information_schema');
  IF _r IS NOT NULL THEN
    _bad := _bad || E'\n  POST-004 SECURITY INVOKER function(s) still name post_media: ' || _r;
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'VID-PM-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-005 · by effect, as the API role: a member cannot read post_media, and
  -- the helper answers false for a post that is not theirs.
  SELECT pm.post_id INTO _any FROM public.post_media pm LIMIT 1;   -- read as the owner, before the switch
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM public.post_media LIMIT 1;
    _bad := _bad || E'\n  POST-005 authenticated can still SELECT post_media';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF public.video_publish_own_post_has_media(_any) IS DISTINCT FROM false THEN
    _bad := _bad || E'\n  POST-005 the helper did not answer false for a post that is not the caller''s';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF _bad <> '' THEN
    RAISE EXCEPTION 'VID-PM-POST:%', _bad USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'VID-PM-0004 (lane %): video_publish_post reads post_media only through video_publish_own_post_has_media (DEFINER, own post); anon/authenticated hold no privilege on post_media (= production)',
    current_setting('p32.lane', true);
END
$postconditions$;

COMMIT;
