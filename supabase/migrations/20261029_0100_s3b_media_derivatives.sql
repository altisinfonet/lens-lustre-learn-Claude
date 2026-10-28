-- ═══════════════════════════════════════════════════════════════════════════
-- S3-b · 20261029_0100 — the derivative ladder, server-side (600/1080/1440 WebP)
-- Lanes: staging and production. Design: docs/evidence/d2/S3/DESIGN.md §2, §5.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS ADDS (expand only — nothing existing is changed or removed):
--   public.media_rung_dims(int,int,int)            pure: rung → width/height,
--                                                  no upscaling (min(rung, long edge))
--   public.media_derivative_key(uuid,uuid,text,int) pure: the ONE place a derivative
--                                                  key is spelled. Never an original:
--                                                  public  post-images/<owner>/d/<media>/w<rung>.webp
--                                                  private photo/<owner>/<media>/w<rung>.webp (video bucket)
--   public.media_derivative_worker_ok()            caller is an admin or the converter account
--   public.media_derivative_queue(int, uuid)       the missing work (resumable by construction)
--   public.media_derivative_source(uuid)           the original's key, for the worker's download
--   public.media_derivative_target(uuid,text,int)  key + exact dimensions the writer must produce
--   public.media_derivative_record(uuid,text,int,text) records ONE stored rung in
--                                                  media_objects.derivatives (keys 600/1080/1440
--                                                  public, p600/p1080/p1440 private) — the orphan
--                                                  sweep counts every value there as referenced.
--
-- WHO MAY CALL: admin or converter only (42501 for every other member, anon
-- holds no EXECUTE). These are worker paths, not member read paths: they never
-- return sha256, state, verified_at or anything about a post's content.
--
-- AUDIENCE: a media object referenced by a public post needs the PUBLIC set;
-- one referenced by a friends-only / only-me post needs the PRIVATE set (both,
-- if it is in both). A private derivative is never written to the public bucket.
--
-- NOT RE-RUNNABLE: PRE-002 refuses once media_derivative_queue exists.
-- ROLLBACK: supabase/rollback/20261029_0100_s3b_media_derivatives_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_s3b_media_derivatives.sql (FAIL before, PASS after)
--           supabase/migrations/PROBE_s3b_derivative_coverage.sql (read-only coverage %)
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
BEGIN
  IF to_regclass('public.media_objects') IS NULL OR to_regclass('public.post_media') IS NULL
     OR to_regclass('public.posts') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.video_is_converter()') IS NULL THEN
    RAISE EXCEPTION 'S3B-0100-PRE-001: media_objects, post_media, posts, has_role(uuid,app_role) or video_is_converter() is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.media_derivative_queue(integer,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'S3B-0100-PRE-002: media_derivative_queue() already exists — 20261029_0100 is applied'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. pure helpers ─────────────────────────────────────────────────────────
CREATE FUNCTION public.media_rung_dims(_w integer, _h integer, _rung integer, OUT width integer, OUT height integer)
LANGUAGE sql IMMUTABLE STRICT SET search_path TO '' AS $fn$
  SELECT CASE WHEN _w >= _h THEN least(_rung, _w)
              ELSE greatest(1, round(_w::numeric * least(_rung, _h) / _h)::integer) END,
         CASE WHEN _w >= _h THEN greatest(1, round(_h::numeric * least(_rung, _w) / _w)::integer)
              ELSE least(_rung, _h) END;
$fn$;

CREATE FUNCTION public.media_derivative_key(_owner uuid, _media uuid, _target text, _rung integer)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path TO '' AS $fn$
  SELECT CASE
           WHEN _rung NOT IN (600, 1080, 1440) THEN NULL
           WHEN _target = 'public'  THEN 'post-images/' || _owner::text || '/d/' || _media::text || '/w' || _rung::text || '.webp'
           WHEN _target = 'private' THEN 'photo/' || _owner::text || '/' || _media::text || '/w' || _rung::text || '.webp'
         END;
$fn$;

CREATE FUNCTION public.media_derivative_worker_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.video_is_converter());
$fn$;

-- ── 2. the queue: ready media referenced by a post, missing a rung its audience needs
CREATE FUNCTION public.media_derivative_queue(_limit integer DEFAULT 20, _after uuid DEFAULT NULL)
RETURNS TABLE(media_id uuid, target text, rung integer, width integer, height integer,
              src_width integer, src_height integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'MEDIA-3001 only an admin or the converter may read the derivative queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH need AS (
    SELECT DISTINCT pm.media_id AS mid,
           CASE WHEN p.privacy = 'public' THEN 'public' ELSE 'private' END AS tgt
      FROM public.post_media pm
      JOIN public.posts p ON p.id = pm.post_id
  ), todo AS (
    SELECT n.mid, n.tgt, mo.width AS w, mo.height AS h, mo.derivatives AS d
      FROM need n
      JOIN public.media_objects mo ON mo.id = n.mid AND mo.state = 'ready'
     WHERE (_after IS NULL OR n.mid > _after)
       AND EXISTS (SELECT 1 FROM unnest(ARRAY[600, 1080, 1440]) r(x)
                    WHERE NOT (mo.derivatives ? ((CASE WHEN n.tgt = 'private' THEN 'p' ELSE '' END) || r.x::text)))
     ORDER BY n.mid, n.tgt
     LIMIT least(greatest(coalesce(_limit, 20), 1), 50)
  )
  SELECT t.mid, t.tgt, r.x, dm.width, dm.height, t.w, t.h
    FROM todo t
   CROSS JOIN unnest(ARRAY[600, 1080, 1440]) r(x)
   CROSS JOIN LATERAL public.media_rung_dims(t.w, t.h, r.x) dm
   WHERE NOT (t.d ? ((CASE WHEN t.tgt = 'private' THEN 'p' ELSE '' END) || r.x::text))
   ORDER BY t.mid, t.tgt, r.x;
END;
$fn$;

-- ── 3. the original's key, for the worker's download (through the Pages binding)
CREATE FUNCTION public.media_derivative_source(_media_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _k text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'MEDIA-3001 only an admin or the converter may read a derivative source' USING ERRCODE = '42501';
  END IF;
  SELECT mo.derivatives->>'original' INTO _k
    FROM public.media_objects mo
   WHERE mo.id = _media_id AND mo.state = 'ready'
     AND EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.media_id = mo.id);
  IF _k IS NULL OR _k !~ '^post-images/' OR _k LIKE '%..%' THEN
    RAISE EXCEPTION 'MEDIA-3002 no usable original for media %', _media_id USING ERRCODE = 'P0002';
  END IF;
  RETURN _k;
END;
$fn$;

-- ── 4. what the writer must produce for one rung (and whether it is done) ──
CREATE FUNCTION public.media_derivative_target(_media_id uuid, _target text, _rung integer)
RETURNS TABLE(object_key text, width integer, height integer, done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _mo record; _k text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'MEDIA-3001 only an admin or the converter may write derivatives' USING ERRCODE = '42501';
  END IF;
  IF _target NOT IN ('public', 'private') OR _rung NOT IN (600, 1080, 1440) THEN
    RAISE EXCEPTION 'MEDIA-3003 target must be public|private and rung 600|1080|1440' USING ERRCODE = '22023';
  END IF;
  SELECT mo.id, mo.owner_id, mo.width, mo.height, mo.derivatives INTO _mo
    FROM public.media_objects mo WHERE mo.id = _media_id AND mo.state = 'ready';
  IF _mo.id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
        WHERE pm.media_id = _media_id
          AND (CASE WHEN p.privacy = 'public' THEN 'public' ELSE 'private' END) = _target) THEN
    -- A private derivative is never planned for media no non-public post uses, and vice versa.
    RAISE EXCEPTION 'MEDIA-3004 media % needs no % derivative', _media_id, _target USING ERRCODE = 'P0002';
  END IF;
  _k := public.media_derivative_key(_mo.owner_id, _mo.id, _target, _rung);
  RETURN QUERY
    SELECT _k, d.width, d.height,
           (_mo.derivatives ? ((CASE WHEN _target = 'private' THEN 'p' ELSE '' END) || _rung::text))
      FROM public.media_rung_dims(_mo.width, _mo.height, _rung) d;
END;
$fn$;

-- ── 5. record ONE stored rung. true = recorded now, false = already recorded.
CREATE FUNCTION public.media_derivative_record(_media_id uuid, _target text, _rung integer, _object_key text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _t record; _slot text;
BEGIN
  SELECT * INTO _t FROM public.media_derivative_target(_media_id, _target, _rung);   -- checks caller, args, audience
  IF _object_key IS DISTINCT FROM _t.object_key THEN
    RAISE EXCEPTION 'MEDIA-3005 key is not the derivative key for media % (% %)', _media_id, _target, _rung USING ERRCODE = '22023';
  END IF;
  _slot := (CASE WHEN _target = 'private' THEN 'p' ELSE '' END) || _rung::text;
  UPDATE public.media_objects
     SET derivatives = derivatives || jsonb_build_object(_slot, _t.object_key)
   WHERE id = _media_id AND state = 'ready' AND NOT (derivatives ? _slot);
  RETURN FOUND;
END;
$fn$;

-- ── 6. privileges: worker paths for authenticated (checked inside); never anon
REVOKE ALL ON FUNCTION public.media_rung_dims(integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_derivative_key(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_derivative_worker_ok() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_derivative_queue(integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.media_derivative_source(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.media_derivative_target(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.media_derivative_record(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.media_derivative_queue(integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.media_derivative_source(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.media_derivative_target(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.media_derivative_record(uuid, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.media_rung_dims(integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.media_derivative_key(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.media_derivative_worker_ok() TO service_role;

COMMENT ON FUNCTION public.media_derivative_record(uuid, text, integer, text) IS
  'S3-b: records one stored derivative rung in media_objects.derivatives (600/1080/1440 public, p600/p1080/p1440 private). '
  'Admin or converter only. The key must be media_derivative_key(); never an original.';

COMMIT;
