-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan · 20261110_0109 — THE OLD PHOTOS' CREDITED COPY (save target).
-- Lanes: staging and production. Applies once (PRE-002).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner (3 Nov 2026): "credit old all photos from starting: yes". Every post
-- photo posted before the New Photos plan (an UNMARKED image_urls entry: no
-- -l4 / -l4f / -l5 / -l5f) gets a credited copy with the v4 small credit, drawn
-- from its CLEAN original (the URL the post shows — never a `-l4` copy, which
-- carries the old big credit). The web's "save image as" / "copy image
-- address" then gets that copy, exactly like a new photo; the screen never
-- shows a credit; the app has no save.
--
-- NO POST IS REPOINTED (image_urls untouched): the credited copy is found by a
-- LOOKUP, this file's table, read with the same access rule as the camera
-- details (can_view_post). A post whose photo changes simply stops matching
-- (the lookup returns a copy only while the post still names that exact URL).
--
--   photo_old_credit                    one row per credited old photo (post, ord, src_url → credited_url)
--   photo_old_credit_class(url)         internal: 'photos' | 'avatars' | 'supabase' | NULL (marked / other)
--   photo_old_credit_key(post, user, ord, url)  internal: the copy's DERIVED key, a NEW name in the
--                                       member's folder: post-images/<user>/posts/credit/<post>-<ord>-<md5(url)[:12]>.webp
--   photo_old_credit_queue(limit, after)  worker: old photos still without a current copy (+ owner name for the credit)
--   photo_old_credit_target(post, ord)  worker: that photo's source URL + derived key + done
--   photo_old_credit_record(post, ord, key)  worker: record it (key must be the derived key)
--   post_photo_credit_for(post_ids[])   anon + authenticated: the credited copies of posts the caller
--                                       can view (can_view_post), only while the post still names the source
--   (worker functions: SECURITY DEFINER search_path "", authenticated only, the
--    body refuses everybody but media_derivative_worker_ok() — PHOTO-OC-001)
--
-- Files: written only by the Pages route /api/media/photoset/oldcredit (never
-- overwrites, never deletes) from tools/media-derivatives/old-credit.mjs.
-- detect-orphan-files lists photo_old_credit.credited_url as a reference.
--
-- ROLLBACK: supabase/rollback/20261110_0109_photo_old_credit_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0109_photo_old_credit.sql (FAIL before the apply)
-- CENSUS:   supabase/migrations/PROBE_20261110_0109_photo_old_credit_census.sql (FAIL until every old photo has its copy)
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

DO $pre$
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regclass('public.posts') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('public.photo_set_backfill_cdn()') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'OC-0109-PRE-001: posts, profiles, has_role, media_derivative_worker_ok, photo_set_backfill_cdn (0101) or can_view_post is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.photo_old_credit') IS NOT NULL OR to_regprocedure('public.post_photo_credit_for(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'OC-0109-PRE-002: old-credit objects already exist — 20261110_0109 is applied';
  END IF;
END
$pre$;

-- ── 1. the table ────────────────────────────────────────────────────────────
CREATE TABLE public.photo_old_credit (
  post_id        uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  ord            integer     NOT NULL CHECK (ord BETWEEN 0 AND 49),
  src_url        text        NOT NULL,
  credited_url   text        NOT NULL CHECK (credited_url ~ '^https://[a-z0-9.-]+/post-images/[0-9a-f-]{36}/posts/credit/[0-9a-f-]{36}-[0-9]{1,2}-[0-9a-f]{12}\.webp$'),
  credit_version integer     NOT NULL CHECK (credit_version >= 4),
  recorded_by    uuid,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, ord)
);
ALTER TABLE public.photo_old_credit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_old_credit FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.photo_old_credit IS
  'Photo plan 0109: the credited copy (v4 small credit) of an old, unmarked post photo — the web save target. '
  'Written only by photo_old_credit_record(); read only by post_photo_credit_for().';

-- ── 2. internal helpers ─────────────────────────────────────────────────────
CREATE FUNCTION public.photo_old_credit_class(_url text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO '' AS $fn$
DECLARE _cdn text := public.photo_set_backfill_cdn();
BEGIN
  IF _url IS NULL OR position('..' IN _url) > 0 THEN RETURN NULL; END IF;
  -- a photo of the new sets (or one of their copies) is never an old photo
  IF _url ~* '-l[45]f?(-thumb|-r[0-9]{3,4}c?)?\.webp([?#].*)?$' THEN RETURN NULL; END IF;
  IF left(_url, length('https://' || _cdn || '/post-images/')) = 'https://' || _cdn || '/post-images/'
     AND _url !~ '/posts/credit/' THEN RETURN 'photos'; END IF;
  IF left(_url, length('https://' || _cdn || '/avatars/')) = 'https://' || _cdn || '/avatars/' THEN RETURN 'avatars'; END IF;
  IF _url ~ '^https://[a-z0-9]{20}\.supabase\.co/storage/v1/object/public/' THEN RETURN 'supabase'; END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.photo_old_credit_class(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.photo_old_credit_key(_post_id uuid, _user_id uuid, _ord integer, _url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $fn$
  SELECT 'post-images/' || _user_id::text || '/posts/credit/' || _post_id::text || '-' || _ord::text
         || '-' || left(md5(_url), 12) || '.webp'
$fn$;
REVOKE ALL ON FUNCTION public.photo_old_credit_key(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;

-- ── 3. the worker's three functions ─────────────────────────────────────────
-- The geometry version every copy is drawn with now (src/lib/creditGeometry.mjs: 4).
CREATE FUNCTION public.photo_old_credit_queue(_limit integer, _after uuid)
RETURNS TABLE(post_id uuid, ord integer, src_url text, owner_full_name text, owner_handle text, owner_is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-OC-001 only an admin or the converter may read the old-credit queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, (u.i - 1)::integer, u.url, pr.full_name, pr.custom_url,
         public.has_role(p.user_id, 'admin'::public.app_role)
    FROM public.posts p
   CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY AS u(url, i)
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
   WHERE u.i <= 50
     AND (_after IS NULL OR p.id > _after)
     AND public.photo_old_credit_class(u.url) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.photo_old_credit c
                      WHERE c.post_id = p.id AND c.ord = u.i - 1 AND c.src_url = u.url AND c.credit_version >= 4)
   ORDER BY p.id, u.i
   LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END;
$fn$;

CREATE FUNCTION public.photo_old_credit_target(_post_id uuid, _ord integer)
RETURNS TABLE(src_url text, credited_key text, done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _url text; _uid uuid;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-OC-001 only an admin or the converter may write old-credit copies' USING ERRCODE = '42501';
  END IF;
  IF _ord IS NULL OR _ord NOT BETWEEN 0 AND 49 THEN RETURN; END IF;
  SELECT p.image_urls[_ord + 1], p.user_id INTO _url, _uid FROM public.posts p WHERE p.id = _post_id;
  IF public.photo_old_credit_class(_url) IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT _url, public.photo_old_credit_key(_post_id, _uid, _ord, _url),
    EXISTS (SELECT 1 FROM public.photo_old_credit c
             WHERE c.post_id = _post_id AND c.ord = _ord AND c.src_url = _url AND c.credit_version >= 4);
END;
$fn$;

CREATE FUNCTION public.photo_old_credit_record(_post_id uuid, _ord integer, _key text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _url text; _uid uuid; _k text; _new text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-OC-001 only an admin or the converter may record old-credit copies' USING ERRCODE = '42501';
  END IF;
  IF _ord IS NULL OR _ord NOT BETWEEN 0 AND 49 THEN
    RAISE EXCEPTION 'PHOTO-OC-002 ord out of range' USING ERRCODE = '22023';
  END IF;
  SELECT p.image_urls[_ord + 1], p.user_id INTO _url, _uid FROM public.posts p WHERE p.id = _post_id;
  IF public.photo_old_credit_class(_url) IS NULL THEN
    RAISE EXCEPTION 'PHOTO-OC-003 the post does not name an old photo at this place' USING ERRCODE = '22023';
  END IF;
  _k := public.photo_old_credit_key(_post_id, _uid, _ord, _url);
  IF _key IS DISTINCT FROM _k THEN
    RAISE EXCEPTION 'PHOTO-OC-002 the key is not this photo''s credited copy' USING ERRCODE = '22023';
  END IF;
  _new := 'https://' || public.photo_set_backfill_cdn() || '/' || _k;
  INSERT INTO public.photo_old_credit (post_id, ord, src_url, credited_url, credit_version, recorded_by)
  VALUES (_post_id, _ord, _url, _new, 4, auth.uid())
  ON CONFLICT (post_id, ord) DO UPDATE
     SET src_url = EXCLUDED.src_url, credited_url = EXCLUDED.credited_url, credit_version = EXCLUDED.credit_version,
         recorded_by = EXCLUDED.recorded_by, recorded_at = now()
   WHERE public.photo_old_credit.src_url IS DISTINCT FROM EXCLUDED.src_url
      OR public.photo_old_credit.credit_version < EXCLUDED.credit_version;
  RETURN _new;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_old_credit_queue(integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_old_credit_target(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_old_credit_record(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_old_credit_queue(integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_old_credit_target(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_old_credit_record(uuid, integer, text) TO authenticated;

-- ── 4. the lookup the web reads ─────────────────────────────────────────────
CREATE FUNCTION public.post_photo_credit_for(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, src_url text, credited_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-OC-008: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.post_id, c.ord, c.src_url, c.credited_url
    FROM public.photo_old_credit c
    JOIN public.posts p ON p.id = c.post_id
   WHERE c.post_id = ANY (p_post_ids)
     -- ⚠ DO NOT REMOVE. This is the access control (as post_photo_camera_for).
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     -- only while the post still shows exactly that photo at that place
     AND p.image_urls[c.ord + 1] = c.src_url
   ORDER BY c.post_id, c.ord;
END;
$fn$;
REVOKE ALL ON FUNCTION public.post_photo_credit_for(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_credit_for(uuid[]) TO anon, authenticated;
COMMENT ON FUNCTION public.post_photo_credit_for(uuid[]) IS
  'Photo plan 0109: the credited copies of old photos of posts the caller can view (can_view_post), '
  'only while the post still names the source URL. At most 50 ids (PHOTO-OC-008).';

DO $post$
DECLARE _n bigint;
BEGIN
  IF has_table_privilege('anon', 'public.photo_old_credit', 'SELECT') OR has_table_privilege('authenticated', 'public.photo_old_credit', 'SELECT') THEN
    RAISE EXCEPTION 'OC-0109-POST-001: photo_old_credit is readable by anon/authenticated';
  END IF;
  SELECT count(*) INTO _n FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY u(url, i)
   WHERE u.i <= 50 AND public.photo_old_credit_class(u.url) IS NOT NULL;
  RAISE NOTICE 'OC-0109 applied on %: % old post photo(s) to credit', current_setting('p32.lane'), _n;
END
$post$;

COMMIT;
