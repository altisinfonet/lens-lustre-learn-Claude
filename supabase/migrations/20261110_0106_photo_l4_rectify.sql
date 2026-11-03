-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan · 20261110_0106 — RECTIFY THE `-l4` POSTS: the worker's functions.
-- Lanes: staging and production. Applies once (PRE-002).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner-approved (3 Nov 2026): photos uploaded while New Photos was on (2 → 3
-- Nov) are stored only as a `-l4` set whose URL IS the credited 2048 with the
-- first, big credit (production census 41607495064: 3 posts / 5 photos, none
-- small). Each LARGE `-l4` photo gets a v3 `-l5` set made from its CLEAN 1080
-- (key rules: src/lib/media/photoL4Rectify.ts; writer: the Pages route
-- /api/media/photoset/rectify + tools/media-derivatives/rectify-l4.mjs). This
-- file only lets that writer find the work and record a finished photo.
--
-- CHANGES NOTHING A MEMBER SEES. No post is updated here; the repoint is
-- 20261110_0107 (reversible). No file is touched by SQL.
--
--   photo_l4_rectify        one row per finished photo (old -l4 URL → new -l5 URL + thumb)
--   photo_l4_rectify_swap   the full before/after of each repointed post (0107 writes, its rollback reads)
--   photo_l4_rectify_source_key(url)   internal: the key of a LARGE `-l4` post photo on this lane's CDN
--   photo_l4_rectify_queue()           worker: the photos still to do, with the owner's name for the credit
--   photo_l4_rectify_target(post, ord) worker: that photo's key + whether it is recorded
--   photo_l4_rectify_record(post, ord, new_key) worker: record it (key must be this photo's `-l5` name)
--   (the three worker functions: SECURITY DEFINER search_path="", authenticated
--    only, and the body refuses everybody but media_derivative_worker_ok() —
--    PHOTO-RX-001, 42501; the same gate as the U5 writer, 20261110_0101)
--
-- ROLLBACK: supabase/rollback/20261110_0106_photo_l4_rectify_ROLLBACK.sql (refuses while 0107 has repointed posts)
-- PROBE:    supabase/migrations/PROBE_20261110_0106_photo_l4_rectify.sql
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
  -- PRE-001 · what this file builds on (0101 gives the lane's CDN host).
  IF to_regclass('public.posts') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('public.photo_set_backfill_cdn()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'thumbnail_urls') THEN
    RAISE EXCEPTION 'RX-0106-PRE-001: posts(thumbnail_urls), profiles, has_role, media_derivative_worker_ok or photo_set_backfill_cdn (20261110_0101) is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.photo_l4_rectify') IS NOT NULL OR to_regclass('public.photo_l4_rectify_swap') IS NOT NULL
     OR to_regprocedure('public.photo_l4_rectify_queue()') IS NOT NULL THEN
    RAISE EXCEPTION 'RX-0106-PRE-002: rectify objects already exist — 20261110_0106 is applied';
  END IF;
END
$pre$;

-- ── 1. tables ───────────────────────────────────────────────────────────────
CREATE TABLE public.photo_l4_rectify (
  post_id     uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  ord         integer     NOT NULL CHECK (ord BETWEEN 0 AND 49),
  old_url     text        NOT NULL CHECK (old_url ~ '-w[0-9]{1,4}h[0-9]{1,4}-l4\.webp(\?[^#]*)?$'),
  new_url     text        NOT NULL CHECK (new_url ~ '-w[0-9]{1,4}h[0-9]{1,4}-l5\.webp$'),
  new_thumb   text        NOT NULL CHECK (new_thumb ~ '-w[0-9]{1,4}h[0-9]{1,4}-l5-thumb\.webp$'),
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, ord)
);

CREATE TABLE public.photo_l4_rectify_swap (
  post_id            uuid        PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  old_image_urls     text[]      NOT NULL,
  old_thumbnail_urls text[],
  old_image_url      text,
  old_thumbnail_url  text,
  new_image_urls     text[]      NOT NULL,
  new_thumbnail_urls text[],
  new_image_url      text,
  new_thumbnail_url  text,
  photos_swapped     integer     NOT NULL CHECK (photos_swapped > 0),
  swapped_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.photo_l4_rectify ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_l4_rectify_swap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_l4_rectify, public.photo_l4_rectify_swap FROM PUBLIC, anon, authenticated;

-- ── 2. internal helper ──────────────────────────────────────────────────────
CREATE FUNCTION public.photo_l4_rectify_source_key(_url text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO '' AS $fn$
DECLARE _m text[];
BEGIN
  IF _url IS NULL THEN RETURN NULL; END IF;
  _m := regexp_match(_url,
    '^https://' || replace(public.photo_set_backfill_cdn(), '.', '\.')
    || '/(post-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/posts/[A-Za-z0-9_.-]+?-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp)(?:\?[^#]*)?$');
  IF _m IS NULL OR position('..' IN _m[1]) > 0 THEN RETURN NULL; END IF;
  -- a small -l4 photo (long edge ≤ 1080) has no clean 1080 to start from: not this work
  IF greatest(_m[2]::int, _m[3]::int) <= 1080 THEN RETURN NULL; END IF;
  RETURN _m[1];
END;
$fn$;
REVOKE ALL ON FUNCTION public.photo_l4_rectify_source_key(text) FROM PUBLIC, anon, authenticated;

-- ── 3. the worker's three functions ─────────────────────────────────────────
CREATE FUNCTION public.photo_l4_rectify_queue()
RETURNS TABLE(post_id uuid, ord integer, owner_full_name text, owner_handle text, owner_is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RX-001 only an admin or the converter may read the rectify queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, (u.i - 1)::integer, pr.full_name, pr.custom_url,
         public.has_role(p.user_id, 'admin'::public.app_role)
    FROM public.posts p
   CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY AS u(url, i)
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
   WHERE u.i <= 50
     AND public.photo_l4_rectify_source_key(u.url) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.photo_l4_rectify r
                      WHERE r.post_id = p.id AND r.ord = u.i - 1 AND r.old_url = u.url)
   ORDER BY p.id, u.i
   LIMIT 200;
END;
$fn$;

CREATE FUNCTION public.photo_l4_rectify_target(_post_id uuid, _ord integer)
RETURNS TABLE(source_key text, done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _url text; _k text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RX-001 only an admin or the converter may write rectify copies' USING ERRCODE = '42501';
  END IF;
  IF _ord IS NULL OR _ord NOT BETWEEN 0 AND 49 THEN RETURN; END IF;
  SELECT p.image_urls[_ord + 1] INTO _url FROM public.posts p WHERE p.id = _post_id;
  _k := public.photo_l4_rectify_source_key(_url);
  IF _k IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT _k, EXISTS (SELECT 1 FROM public.photo_l4_rectify r
                                   WHERE r.post_id = _post_id AND r.ord = _ord AND r.old_url = _url);
END;
$fn$;

CREATE FUNCTION public.photo_l4_rectify_record(_post_id uuid, _ord integer, _new_key text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _url text; _k text; _stem text; _m text[]; _new_url text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RX-001 only an admin or the converter may record rectify copies' USING ERRCODE = '42501';
  END IF;
  IF _ord IS NULL OR _ord NOT BETWEEN 0 AND 49 THEN
    RAISE EXCEPTION 'PHOTO-RX-002 ord out of range' USING ERRCODE = '22023';
  END IF;
  SELECT p.image_urls[_ord + 1] INTO _url FROM public.posts p WHERE p.id = _post_id;
  _k := public.photo_l4_rectify_source_key(_url);
  IF _k IS NULL THEN
    RAISE EXCEPTION 'PHOTO-RX-003 the post does not name a large -l4 photo at this place' USING ERRCODE = '22023';
  END IF;
  -- the new key must be THIS photo's -l5 name: same stem, its own 1080 size
  _stem := regexp_replace(_k, '-w[0-9]{1,4}h[0-9]{1,4}-l4\.webp$', '');
  IF _new_key IS NULL OR left(_new_key, length(_stem)) <> _stem THEN
    RAISE EXCEPTION 'PHOTO-RX-002 the new key is not this photo''s -l5 name' USING ERRCODE = '22023';
  END IF;
  _m := regexp_match(substr(_new_key, length(_stem) + 1), '^-w([0-9]{1,4})h([0-9]{1,4})-l5\.webp$');
  IF _m IS NULL OR greatest(_m[1]::int, _m[2]::int) > 1080 OR least(_m[1]::int, _m[2]::int) < 1 THEN
    RAISE EXCEPTION 'PHOTO-RX-002 the new key is not this photo''s -l5 name' USING ERRCODE = '22023';
  END IF;
  _new_url := 'https://' || public.photo_set_backfill_cdn() || '/' || _new_key;
  INSERT INTO public.photo_l4_rectify (post_id, ord, old_url, new_url, new_thumb, recorded_by)
  VALUES (_post_id, _ord, _url, _new_url, left(_new_url, -5) || '-thumb.webp', auth.uid())
  ON CONFLICT (post_id, ord) DO UPDATE
     SET old_url = EXCLUDED.old_url, new_url = EXCLUDED.new_url, new_thumb = EXCLUDED.new_thumb,
         recorded_by = EXCLUDED.recorded_by, recorded_at = now()
   WHERE public.photo_l4_rectify.old_url IS DISTINCT FROM EXCLUDED.old_url;
  RETURN _new_url;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_l4_rectify_queue() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_l4_rectify_target(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_l4_rectify_record(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_l4_rectify_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_l4_rectify_target(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_l4_rectify_record(uuid, integer, text) TO authenticated;

DO $post$
DECLARE _n bigint;
BEGIN
  SELECT count(*) INTO _n FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
   WHERE public.photo_l4_rectify_source_key(u.url) IS NOT NULL;
  RAISE NOTICE 'RX-0106 applied on %: % large -l4 post photo(s) to rectify', current_setting('p32.lane'), _n;
END
$post$;

COMMIT;
