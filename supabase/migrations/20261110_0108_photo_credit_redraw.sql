-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan · 20261110_0108 — REDRAW the credit of the rectified photos (v3).
-- Lanes: staging and production. Applies once (PRE-002).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner order (3 Nov 2026, 12:45Z, after his web test): "1/3 text font small
-- and 50% opacity down". New uploads draw the v3 credit from the shared
-- geometry (src/lib/creditGeometry.mjs). The credited copies that ALREADY
-- exist on a lane are the rectified photos' `-l5-r2048c` (20261110_0106/0107;
-- production census 3 Nov 12:50Z: 5 files, all v2). This file lets the rectify
-- writer find them and record each redraw:
--   photo_l4_rectify.credit_version     the geometry each credited copy carries (2 = v2, the rectify run)
--   photo_credit_redraw_queue(_version) worker: recorded photos whose post still names the -l5 URL and
--                                       whose credit is older than _version, with the owner's name
--   photo_credit_redraw_target(post, ord) worker: that photo's -l5 key (only while the post names it)
--   photo_credit_redraw_record(post, ord, version) worker: record the redraw
--   (SECURITY DEFINER search_path="", authenticated only, the body refuses all
--    but media_derivative_worker_ok() — PHOTO-RX-001, as 0106)
--
-- CHANGES NOTHING A MEMBER SEES and touches no file: the route
-- /api/media/photoset/rectify (op=redraw) rewrites ONLY a recorded photo's
-- credited copy (`-r2048c`, a derived file, re-drawable from the clean copy
-- at any time), at exactly its current size; the web loads it as `?cv=3`.
--
-- ROLLBACK: supabase/rollback/20261110_0108_photo_credit_redraw_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0108_photo_credit_redraw.sql (FAIL until every recorded photo is at v3)
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
  IF to_regclass('public.photo_l4_rectify') IS NULL OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL OR to_regprocedure('public.photo_set_backfill_cdn()') IS NULL THEN
    RAISE EXCEPTION 'RX-0108-PRE-001: 20261110_0106 (photo_l4_rectify) or its helpers are missing on this lane';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photo_l4_rectify' AND column_name = 'credit_version')
     OR to_regprocedure('public.photo_credit_redraw_queue(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'RX-0108-PRE-002: 20261110_0108 is applied already';
  END IF;
END
$pre$;

-- existing rows were drawn with v2; a photo rectified after this file is drawn with
-- the shared geometry (v3), so new rows default to 3 (review of #856)
ALTER TABLE public.photo_l4_rectify ADD COLUMN credit_version integer NOT NULL DEFAULT 2 CHECK (credit_version BETWEEN 1 AND 99);
ALTER TABLE public.photo_l4_rectify ALTER COLUMN credit_version SET DEFAULT 3;

CREATE FUNCTION public.photo_credit_redraw_queue(_version integer)
RETURNS TABLE(post_id uuid, ord integer, owner_full_name text, owner_handle text, owner_is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RX-001 only an admin or the converter may read the redraw queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT x.post_id, x.ord, pr.full_name, pr.custom_url, public.has_role(p.user_id, 'admin'::public.app_role)
    FROM public.photo_l4_rectify x
    JOIN public.posts p ON p.id = x.post_id AND p.image_urls[x.ord + 1] = x.new_url
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
   WHERE x.credit_version < coalesce(_version, 0)
   ORDER BY x.post_id, x.ord;
END;
$fn$;

CREATE FUNCTION public.photo_credit_redraw_target(_post_id uuid, _ord integer)
RETURNS TABLE(url_key text, credit_version integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _cdn text := 'https://' || public.photo_set_backfill_cdn() || '/';
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RX-001 only an admin or the converter may redraw credited copies' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT substr(x.new_url, length(_cdn) + 1), x.credit_version
    FROM public.photo_l4_rectify x
    JOIN public.posts p ON p.id = x.post_id AND p.image_urls[x.ord + 1] = x.new_url
   WHERE x.post_id = _post_id AND x.ord = _ord AND left(x.new_url, length(_cdn)) = _cdn;
END;
$fn$;

CREATE FUNCTION public.photo_credit_redraw_record(_post_id uuid, _ord integer, _version integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _n integer;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RX-001 only an admin or the converter may record a redraw' USING ERRCODE = '42501';
  END IF;
  IF _version IS NULL OR _version NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'PHOTO-RX-002 version out of range' USING ERRCODE = '22023';
  END IF;
  UPDATE public.photo_l4_rectify x SET credit_version = _version
   WHERE x.post_id = _post_id AND x.ord = _ord AND x.credit_version < _version;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_credit_redraw_queue(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_credit_redraw_target(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_credit_redraw_record(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_credit_redraw_queue(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_credit_redraw_target(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_credit_redraw_record(uuid, integer, integer) TO authenticated;

DO $post$
BEGIN
  RAISE NOTICE 'RX-0108 applied on %: % rectified photo(s) carry an older credit than v3',
    current_setting('p32.lane'), (SELECT count(*) FROM public.photo_l4_rectify WHERE credit_version < 3);
END
$post$;

COMMIT;
