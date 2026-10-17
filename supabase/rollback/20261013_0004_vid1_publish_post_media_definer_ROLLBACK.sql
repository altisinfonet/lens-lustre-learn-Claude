-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261013_0004 — video_publish_post() reads post_media through a
-- SECURITY DEFINER helper; anon/authenticated hold no privilege on post_media.
-- Lanes: staging and production (the same lanes as the file it undoes).
--
-- Restores exactly the pre-20261013_0004 state on the lane it runs on:
--   * video_publish_post(): the 20261011_0003 body, verbatim (md5
--     2f326237f4df8c1d33b647dfd4ab81bc), and its 20261011_0003 comment; ACL kept;
--   * drops public.video_publish_own_post_has_media(uuid);
--   * STAGING ONLY: re-grants SELECT on post_media to authenticated (granted by
--     postgres, as 20261013_0001 left it). On production nothing is granted —
--     production never had it.
--
-- ⚠ WHAT ROLLING BACK MEANS
--   staging:    authenticated can read post_media directly again (the keep
--               20261013_0001 documented).
--   production: video_publish_post() reads post_media as the member again, so
--               a replay that finds an unlinked post raises 42501 "permission
--               denied for table post_media". Use only if the helper itself is
--               found wrong — and then fix forward.
--
-- RB-PRE-001 refuses unless the objects are exactly in 20261013_0004's
-- post-state, so this cannot run before 20261013_0004, twice, or over a later
-- change.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _acl text;
BEGIN
  -- RB-PRE-001 · exactly 20261013_0004's post-state.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.video_publish_post(uuid,text,text,text[],text)'))
       IS DISTINCT FROM '243e37c6c8bd8403b19d43ad4c57220d'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.video_publish_own_post_has_media(uuid)'))
       IS DISTINCT FROM '8fabf828db14522ad56ca5d7ae6bc63c' THEN
    RAISE EXCEPTION 'VID-PM-RB-PRE-001: video_publish_post() / video_publish_own_post_has_media() are not 20261013_0004''s bodies (not applied, already rolled back, or changed since) — refusing';
  END IF;
  SELECT string_agg(x, ',' ORDER BY x COLLATE "C") INTO _acl
    FROM (SELECT concat_ws('|', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                           a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
            FROM pg_class c, LATERAL aclexplode(c.relacl) a
           WHERE c.oid = 'public.post_media'::regclass) s;
  IF _acl IS DISTINCT FROM 'postgres|DELETE|postgres|false,postgres|INSERT|postgres|false,postgres|MAINTAIN|postgres|false,postgres|REFERENCES|postgres|false,postgres|SELECT|postgres|false,postgres|TRIGGER|postgres|false,postgres|TRUNCATE|postgres|false,postgres|UPDATE|postgres|false,service_role|DELETE|postgres|false,service_role|INSERT|postgres|false,service_role|MAINTAIN|postgres|false,service_role|REFERENCES|postgres|false,service_role|SELECT|postgres|false,service_role|TRIGGER|postgres|false,service_role|TRUNCATE|postgres|false,service_role|UPDATE|postgres|false' THEN
    RAISE EXCEPTION 'VID-PM-RB-PRE-001: post_media ACL is not 20261013_0004''s post-state — refusing (read %)', coalesce(_acl, '(default)');
  END IF;
  -- RB-PRE-002 · the GRANT below is recorded as the owner's (grantor postgres).
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.post_media'::regclass) <> current_user THEN
    RAISE EXCEPTION 'VID-PM-RB-PRE-002: public.post_media is not owned by % — refusing', current_user;
  END IF;
END
$preconditions$;

-- ── 1. video_publish_post(): the 20261011_0003 body, verbatim ───────────────
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
      IF EXISTS (SELECT 1 FROM public.posts p
                  WHERE p.id = _post
                    AND (COALESCE(cardinality(p.image_urls), 0) > 0 OR COALESCE(p.image_url, '') <> ''))
         OR EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = _post) THEN
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
  'VID-1 20261011_0003: post + post_videos link in one transaction, as the member (SECURITY INVOKER). Idempotent by key.';

-- ── 2. the helper goes ──────────────────────────────────────────────────────
DROP FUNCTION public.video_publish_own_post_has_media(uuid);

-- ── 3. staging only: authenticated SELECT on post_media, as 20261013_0001 left it
DO $regrant$
BEGIN
  IF current_setting('p32.lane', true) = 'staging' THEN
    GRANT SELECT ON TABLE public.post_media TO authenticated;
  END IF;
END
$regrant$;

DO $postconditions$
DECLARE
  _lane text := current_setting('p32.lane', true);
  _fn   regprocedure := 'public.video_publish_post(uuid,text,text,text[],text)'::regprocedure;
  _acl  text;
  _want text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = _fn) IS DISTINCT FROM '2f326237f4df8c1d33b647dfd4ab81bc'
     OR (SELECT prosecdef FROM pg_proc WHERE oid = _fn) THEN
    RAISE EXCEPTION 'VID-PM-RB-POST-001: video_publish_post() is not the 20261011_0003 SECURITY INVOKER body';
  END IF;
  IF to_regprocedure('public.video_publish_own_post_has_media(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID-PM-RB-POST-002: video_publish_own_post_has_media(uuid) still exists';
  END IF;
  IF NOT has_function_privilege('authenticated', _fn, 'EXECUTE') OR has_function_privilege('anon', _fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'VID-PM-RB-POST-003: video_publish_post() EXECUTE changed';
  END IF;
  SELECT string_agg(x, ',' ORDER BY x COLLATE "C") INTO _acl
    FROM (SELECT concat_ws('|', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                           a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
            FROM pg_class c, LATERAL aclexplode(c.relacl) a
           WHERE c.oid = 'public.post_media'::regclass) s;
  _want := CASE WHEN _lane = 'staging' THEN 'authenticated|SELECT|postgres|false,' ELSE '' END
        || 'postgres|DELETE|postgres|false,postgres|INSERT|postgres|false,postgres|MAINTAIN|postgres|false,postgres|REFERENCES|postgres|false,postgres|SELECT|postgres|false,postgres|TRIGGER|postgres|false,postgres|TRUNCATE|postgres|false,postgres|UPDATE|postgres|false,service_role|DELETE|postgres|false,service_role|INSERT|postgres|false,service_role|MAINTAIN|postgres|false,service_role|REFERENCES|postgres|false,service_role|SELECT|postgres|false,service_role|TRIGGER|postgres|false,service_role|TRUNCATE|postgres|false,service_role|UPDATE|postgres|false';
  IF _acl IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'VID-PM-RB-POST-004: post_media ACL on lane % is not the pre-20261013_0004 state (read %)', _lane, coalesce(_acl, '(default)');
  END IF;
  RAISE NOTICE 'VID-PM-0004 ROLLBACK (lane %): video_publish_post is the 20261011_0003 body again; helper dropped; post_media ACL restored', _lane;
END
$postconditions$;

COMMIT;
