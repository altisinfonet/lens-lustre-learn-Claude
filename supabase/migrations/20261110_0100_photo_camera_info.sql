-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan U1a · 20261110_0100 — camera details for posts (database half),
-- behind the new switch `photo_set_v2`, created OFF. Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE: camera details for posts are stored without GPS, writable only by the
-- author while photo_set_v2 allows it, hideable by the author, readable under
-- can_view_post; switch created OFF.
--
-- WHAT. The phone reads each photo's camera details BEFORE the WebP re-encode
-- (client unit, separate) and saves them here after the post exists:
--   camera (make + model) · lens · focal_length · aperture · shutter · iso · taken_at
-- GPS / location is NEVER stored: a location-looking key or value is REFUSED
-- with PHOTO-CAM-003 (never silently dropped), any other unknown key with
-- PHOTO-CAM-004, and the table's own CHECK allows only the seven keys above,
-- so not even a service-role write can store a coordinate.
--
-- OBJECTS (expand only):
--   · switch 'photo_set_v2' in public.feature_access — created mode 'off', audited.
--     feature_access_feature_check is REBUILT as (the lane's current list +
--     'photo_set_v2'), read under an ACCESS EXCLUSIVE lock, so a key another
--     unit added keeps working.
--   · public.post_photo_camera (post_id, ord, info jsonb, updated_at)
--       PK (post_id, ord) — the same key as post_media, so slide N of a post
--       is the same N in post_media.ord AND in posts.image_urls (legacy posts
--       have no post_media rows, so a media_id key could not describe them).
--       ON DELETE CASCADE from posts: deleting a post deletes its details.
--   · public.post_photo_camera_hidden (post_id PK, hidden_at)
--       A row = the author hid the details of that post. A separate per-post
--       table (not a column on each photo row) because the choice is about the
--       POST: it can be made before any details are written, survives a
--       re-save of the details, and one row covers every photo of the post.
--   · RLS ON for both tables, no policies, nothing granted to anon /
--     authenticated (as media_objects / post_media): every member read and
--     write goes through the three SECURITY DEFINER functions below.
--   · public.set_post_photo_camera(p_post_id uuid, p_items jsonb) RETURNS integer
--       author only · only while feature_allowed('photo_set_v2', caller) ·
--       strict whitelist · length / range caps · idempotent upsert per ord;
--       an item whose fields are all null/empty deletes that ord's row.
--   · public.set_post_photo_camera_hidden(p_post_id uuid, p_hidden boolean) RETURNS boolean
--       author only, NOT switch-gated (an owner can always hide).
--   · public.post_photo_camera_for(p_post_ids uuid[])
--       RETURNS TABLE(post_id uuid, ord integer, info jsonb, hidden boolean)
--       can_view_post() is the access control (as post_media_for), ≤ 50 ids;
--       a hidden post's rows are returned only to its author. Executable by
--       anon as well as authenticated, like post_media_for: signed-out
--       viewers follow can_view_post (public posts, not hidden).
--   EXECUTE on the two writers: authenticated only (revoked from PUBLIC, anon).
--
-- ERROR CODES (the message starts with the code):
--   PHOTO-CAM-001 not signed in                    (42501)
--   PHOTO-CAM-002 bad payload shape / ord          (22023)
--   PHOTO-CAM-003 location data (key or value)     (22023)
--   PHOTO-CAM-004 unknown key                      (22023)
--   PHOTO-CAM-005 bad value (type, length, range)  (22023)
--   PHOTO-CAM-006 not this post's author / no post (42501)
--   PHOTO-CAM-007 photo_set_v2 not on for caller   (42501)
--   PHOTO-CAM-008 more than 50 post ids            (22023)
--
-- NOT RE-RUNNABLE: PRE-002 refuses once any of the objects exists.
-- ROLLBACK: supabase/rollback/20261110_0100_photo_camera_info_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0100_photo_camera_info.sql
-- FIXTURE:  .github/workflows/d1-photo-camera-fixture.yml (both lane shapes)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE _mode text;
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regclass('public.posts') IS NULL
     OR to_regclass('public.feature_access') IS NULL OR to_regclass('public.feature_access_audit') IS NULL
     OR to_regprocedure('public.feature_allowed(text,uuid)') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'U1A-0100-PRE-001: posts, feature_access(+audit), feature_allowed, can_view_post or auth.uid is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.post_photo_camera') IS NOT NULL
     OR to_regclass('public.post_photo_camera_hidden') IS NOT NULL
     OR to_regprocedure('public.set_post_photo_camera(uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('public.set_post_photo_camera_hidden(uuid,boolean)') IS NOT NULL
     OR to_regprocedure('public.post_photo_camera_for(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'U1A-0100-PRE-002: camera-details objects already exist — 20261110_0100 is applied'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · never take over a switch somebody already turned on.
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  IF _mode IS NOT NULL AND _mode <> 'off' THEN
    RAISE EXCEPTION 'U1A-0100-PRE-003: photo_set_v2 already exists with mode % — refusing (this file only creates it off)', _mode
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the switch, OFF (current list + 'photo_set_v2', read under the lock) ──
LOCK TABLE public.feature_access IN ACCESS EXCLUSIVE MODE;

DO $switch$
DECLARE _def text; _keys text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.feature_access'::regclass AND c.conname = 'feature_access_feature_check';
  -- PRE-004 · the constraint must be the plain "feature IN (...)" list every unit wrote.
  IF _def IS NULL OR _def !~ '^CHECK \(\(feature = ANY \(ARRAY\[''[a-z0-9_]+''::text(, ''[a-z0-9_]+''::text)*\]\)\)\)$' THEN
    RAISE EXCEPTION 'U1A-0100-PRE-004: feature_access_feature_check is not a plain key list (read: %)', coalesce(_def, '<none>')
      USING ERRCODE = 'raise_exception';
  END IF;
  SELECT array_agg(t.m[1] ORDER BY t.i) INTO _keys
    FROM regexp_matches(_def, '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS t(m, i);
  IF NOT ('photo_set_v2' = ANY (_keys)) THEN
    EXECUTE format(
      'ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check, '
      'ADD CONSTRAINT feature_access_feature_check CHECK (feature IN (%s))',
      (SELECT string_agg(quote_literal(k), ', ' ORDER BY i)
         FROM unnest(_keys || 'photo_set_v2'::text) WITH ORDINALITY AS u(k, i)));
  END IF;
  RAISE NOTICE 'U1A-0100: feature_access_feature_check kept % key(s) and allows photo_set_v2', array_length(_keys, 1);
END
$switch$;

WITH ins AS (
  INSERT INTO public.feature_access (feature, mode) VALUES ('photo_set_v2', 'off')
  ON CONFLICT (feature) DO NOTHING
  RETURNING feature
)
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, 'photo_set_v2', 'mode', NULL, 'off', '20261110_0100: switch created, Off (photo plan U1a: camera details)'
  FROM ins;

-- ── 2. storage ──────────────────────────────────────────────────────────────
CREATE TABLE public.post_photo_camera (
  post_id    uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  ord        integer     NOT NULL CHECK (ord BETWEEN 0 AND 49),
  info       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, ord),
  -- Defence in depth under the writer: only the seven keys, never empty, small.
  CONSTRAINT post_photo_camera_info_keys CHECK (
    jsonb_typeof(info) = 'object'
    AND info <> '{}'::jsonb
    AND (info - ARRAY['camera', 'lens', 'focal_length', 'aperture', 'shutter', 'iso', 'taken_at']) = '{}'::jsonb
    AND octet_length(info::text) <= 1024)
);
COMMENT ON TABLE public.post_photo_camera IS
  'Photo plan U1a: camera details per post photo (ord = post_media.ord = image_urls index). Never GPS. '
  'Written only by set_post_photo_camera(), read only by post_photo_camera_for().';

CREATE TABLE public.post_photo_camera_hidden (
  post_id   uuid        PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.post_photo_camera_hidden IS
  'Photo plan U1a: a row = the post''s author hid its camera details. Written only by set_post_photo_camera_hidden().';

ALTER TABLE public.post_photo_camera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_photo_camera_hidden ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_photo_camera, public.post_photo_camera_hidden FROM PUBLIC, anon, authenticated;

-- ── 3. write ────────────────────────────────────────────────────────────────
CREATE FUNCTION public.set_post_photo_camera(p_post_id uuid, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid    uuid := (SELECT auth.uid());
  _keys   constant text[] := ARRAY['ord', 'camera', 'lens', 'focal_length', 'aperture', 'shutter', 'iso', 'taken_at'];
  _item   jsonb;
  _k      text;
  _v      jsonb;
  _s      text;
  _n      numeric;
  _ord    integer;
  _ords   integer[] := '{}';
  _info   jsonb;
  _rows   jsonb := '[]'::jsonb;
  _author uuid;
  _saved  integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'PHOTO-CAM-001: sign in to save camera details' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_post_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'PHOTO-CAM-002: p_items must be a JSON array of 1 to 50 photo items' USING ERRCODE = '22023';
  END IF;

  -- Validate EVERYTHING before touching anything (all or nothing).
  FOR _item IN SELECT e.value FROM jsonb_array_elements(p_items) AS e LOOP
    IF jsonb_typeof(_item) <> 'object' THEN
      RAISE EXCEPTION 'PHOTO-CAM-002: each item must be a JSON object' USING ERRCODE = '22023';
    END IF;
    FOR _k IN SELECT jsonb_object_keys(_item) LOOP
      -- Location first, so it is named as such and never mistaken for a typo.
      IF lower(_k) ~ '(gps|lat|lng|lon|geo|locat|coord|altitude|position|place|address)' THEN
        RAISE EXCEPTION 'PHOTO-CAM-003: location data is never stored (key "%")', left(_k, 40) USING ERRCODE = '22023';
      END IF;
      IF NOT (_k = ANY (_keys)) THEN
        RAISE EXCEPTION 'PHOTO-CAM-004: unknown key "%" (allowed: %)', left(_k, 40), array_to_string(_keys, ', ')
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    _v := _item -> 'ord';
    IF _v IS NULL OR jsonb_typeof(_v) <> 'number' OR _v::numeric <> trunc(_v::numeric)
       OR _v::numeric < 0 OR _v::numeric > 49 THEN
      RAISE EXCEPTION 'PHOTO-CAM-002: ord must be a whole number 0..49' USING ERRCODE = '22023';
    END IF;
    _ord := _v::numeric::integer;
    IF _ord = ANY (_ords) THEN
      RAISE EXCEPTION 'PHOTO-CAM-002: ord % appears twice', _ord USING ERRCODE = '22023';
    END IF;
    _ords := _ords || _ord;

    _info := '{}'::jsonb;
    FOR _k, _v IN SELECT e.key, e.value FROM jsonb_each(_item) AS e WHERE e.key <> 'ord' LOOP
      CONTINUE WHEN jsonb_typeof(_v) = 'null';
      IF jsonb_typeof(_v) = 'string' THEN
        _s := btrim(_v #>> '{}');
        IF _s ~ '°' OR _s ~ '-?[0-9]{1,3}\.[0-9]{3,}\s*[,; /]\s*-?[0-9]{1,3}\.[0-9]{3,}' THEN
          RAISE EXCEPTION 'PHOTO-CAM-003: location data is never stored (value of "%" looks like a position)', _k
            USING ERRCODE = '22023';
        END IF;
        IF _s ~ '[[:cntrl:]]' THEN
          RAISE EXCEPTION 'PHOTO-CAM-005: % holds a control character', _k USING ERRCODE = '22023';
        END IF;
        CONTINUE WHEN _s = '';
      ELSIF jsonb_typeof(_v) = 'number' THEN
        _n := _v::numeric;
      ELSE
        RAISE EXCEPTION 'PHOTO-CAM-005: % must be a string or a number (got %)', _k, jsonb_typeof(_v) USING ERRCODE = '22023';
      END IF;

      CASE _k
        WHEN 'camera', 'lens' THEN
          IF jsonb_typeof(_v) <> 'string' OR char_length(_s) > 100 THEN
            RAISE EXCEPTION 'PHOTO-CAM-005: % must be text of at most 100 characters', _k USING ERRCODE = '22023';
          END IF;
          _info := _info || jsonb_build_object(_k, _s);
        WHEN 'shutter' THEN
          IF jsonb_typeof(_v) <> 'string' OR char_length(_s) > 20
             OR _s !~ '^[0-9]+(\.[0-9]+)?(/[0-9]+(\.[0-9]+)?)?$' THEN
            RAISE EXCEPTION 'PHOTO-CAM-005: shutter must be text like "1/250" or "2.5" (at most 20 characters)' USING ERRCODE = '22023';
          END IF;
          _info := _info || jsonb_build_object(_k, _s);
        WHEN 'taken_at' THEN
          IF jsonb_typeof(_v) <> 'string' OR char_length(_s) > 35
             OR _s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?$' THEN
            RAISE EXCEPTION 'PHOTO-CAM-005: taken_at must be an ISO 8601 date-time (at most 35 characters)' USING ERRCODE = '22023';
          END IF;
          BEGIN
            PERFORM _s::timestamptz;
          EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'PHOTO-CAM-005: taken_at is not a real date-time' USING ERRCODE = '22023';
          END;
          _info := _info || jsonb_build_object(_k, _s);
        WHEN 'focal_length' THEN
          IF jsonb_typeof(_v) <> 'number' OR _n <= 0 OR _n > 5000 THEN
            RAISE EXCEPTION 'PHOTO-CAM-005: focal_length must be a number of millimetres above 0 and at most 5000' USING ERRCODE = '22023';
          END IF;
          _info := _info || jsonb_build_object(_k, _n);
        WHEN 'aperture' THEN
          IF jsonb_typeof(_v) <> 'number' OR _n < 0.5 OR _n > 128 THEN
            RAISE EXCEPTION 'PHOTO-CAM-005: aperture must be an f-number from 0.5 to 128' USING ERRCODE = '22023';
          END IF;
          _info := _info || jsonb_build_object(_k, _n);
        WHEN 'iso' THEN
          IF jsonb_typeof(_v) <> 'number' OR _n <> trunc(_n) OR _n < 1 OR _n > 10000000 THEN
            RAISE EXCEPTION 'PHOTO-CAM-005: iso must be a whole number from 1 to 10000000' USING ERRCODE = '22023';
          END IF;
          _info := _info || jsonb_build_object(_k, _n::bigint);
        ELSE
          RAISE EXCEPTION 'PHOTO-CAM-004: unknown key "%"', left(_k, 40) USING ERRCODE = '22023';
      END CASE;
    END LOOP;
    _rows := _rows || jsonb_build_array(jsonb_build_object('ord', _ord, 'info', _info));
  END LOOP;

  -- Only the author, only while the switch allows it.
  SELECT p.user_id INTO _author FROM public.posts p WHERE p.id = p_post_id;
  IF _author IS NULL OR _author <> _uid THEN
    RAISE EXCEPTION 'PHOTO-CAM-006: only the author of this post can save its camera details' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.feature_allowed('photo_set_v2', _uid) THEN
    RAISE EXCEPTION 'PHOTO-CAM-007: camera details are not switched on for this account (photo_set_v2)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.post_photo_camera c
   USING jsonb_array_elements(_rows) AS r
   WHERE c.post_id = p_post_id AND c.ord = (r.value ->> 'ord')::integer AND r.value -> 'info' = '{}'::jsonb;

  INSERT INTO public.post_photo_camera AS c (post_id, ord, info)
  SELECT p_post_id, (r.value ->> 'ord')::integer, r.value -> 'info'
    FROM jsonb_array_elements(_rows) AS r
   WHERE r.value -> 'info' <> '{}'::jsonb
  ON CONFLICT (post_id, ord) DO UPDATE
     SET info = EXCLUDED.info, updated_at = now()
   WHERE c.info IS DISTINCT FROM EXCLUDED.info;

  SELECT count(*)::integer INTO _saved FROM jsonb_array_elements(_rows) AS r WHERE r.value -> 'info' <> '{}'::jsonb;
  RETURN _saved;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_post_photo_camera(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_post_photo_camera(uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.set_post_photo_camera(uuid, jsonb) IS
  'Photo plan U1a: the post''s author saves camera details [{ord, camera, lens, focal_length, aperture, shutter, iso, taken_at}] '
  'while photo_set_v2 allows it. Strict whitelist; location data refused (PHOTO-CAM-003). Idempotent per ord.';

-- ── 4. hide ─────────────────────────────────────────────────────────────────
CREATE FUNCTION public.set_post_photo_camera_hidden(p_post_id uuid, p_hidden boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE _uid uuid := (SELECT auth.uid()); _author uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'PHOTO-CAM-001: sign in to change camera details' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_post_id IS NULL OR p_hidden IS NULL THEN
    RAISE EXCEPTION 'PHOTO-CAM-002: p_post_id and p_hidden are required' USING ERRCODE = '22023';
  END IF;
  SELECT p.user_id INTO _author FROM public.posts p WHERE p.id = p_post_id;
  IF _author IS NULL OR _author <> _uid THEN
    RAISE EXCEPTION 'PHOTO-CAM-006: only the author of this post can hide its camera details' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Deliberately NOT switch-gated: an owner can always hide.
  IF p_hidden THEN
    INSERT INTO public.post_photo_camera_hidden (post_id) VALUES (p_post_id) ON CONFLICT (post_id) DO NOTHING;
  ELSE
    DELETE FROM public.post_photo_camera_hidden h WHERE h.post_id = p_post_id;
  END IF;
  RETURN p_hidden;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_post_photo_camera_hidden(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_post_photo_camera_hidden(uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.set_post_photo_camera_hidden(uuid, boolean) IS
  'Photo plan U1a: the post''s author hides (true) or shows (false) its camera details. Not switch-gated.';

-- ── 5. read ─────────────────────────────────────────────────────────────────
CREATE FUNCTION public.post_photo_camera_for(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, info jsonb, hidden boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-CAM-008: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.post_id, c.ord, c.info, (h.post_id IS NOT NULL)
    FROM public.post_photo_camera c
    JOIN public.posts p ON p.id = c.post_id
    LEFT JOIN public.post_photo_camera_hidden h ON h.post_id = c.post_id
   WHERE c.post_id = ANY (p_post_ids)
     -- ⚠ DO NOT REMOVE. This is the access control (as in post_media_for).
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     -- Hidden: only the author sees the rows (NULL uid → NULL → no row).
     AND (h.post_id IS NULL OR p.user_id = _uid)
   ORDER BY c.post_id, c.ord;
END;
$fn$;
REVOKE ALL ON FUNCTION public.post_photo_camera_for(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_camera_for(uuid[]) TO anon, authenticated;
COMMENT ON FUNCTION public.post_photo_camera_for(uuid[]) IS
  'Photo plan U1a: camera details (post_id, ord, info, hidden) of posts the caller can view (can_view_post); '
  'a hidden post''s rows only for its author. At most 50 ids (PHOTO-CAM-008).';

-- ── 6. postconditions ───────────────────────────────────────────────────────
DO $postconditions$
DECLARE _mode text;
BEGIN
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  IF _mode IS DISTINCT FROM 'off' THEN
    RAISE EXCEPTION 'U1A-0100-POST-001: photo_set_v2 is not off (read: %)', coalesce(_mode, '<none>') USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.set_post_photo_camera(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_post_photo_camera_hidden(uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_post_photo_camera(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_post_photo_camera_hidden(uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.post_photo_camera_for(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'U1A-0100-POST-002: function grants are not as intended' USING ERRCODE = 'raise_exception';
  END IF;
  IF has_table_privilege('anon', 'public.post_photo_camera', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.post_photo_camera', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.post_photo_camera_hidden', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.post_photo_camera_hidden', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'U1A-0100-POST-003: an API role can reach a camera table directly' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'U1A-0100 (lane %): camera details stored behind photo_set_v2 = off', current_setting('p32.lane');
END
$postconditions$;

COMMIT;
