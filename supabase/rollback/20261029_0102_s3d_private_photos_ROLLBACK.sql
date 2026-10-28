-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261029_0102 — S3-d private photo delivery.
-- Faster first step: media_private_photos → Off in Admin → Features (instant).
-- This file puts post_media_resolved_for back to its 20261029_0101 body
-- (non-public posts: no rows) and removes the switch row and its member list
-- (audit rows stay). Private derivative OBJECTS stay in the video bucket,
-- unreachable without a pass; nothing is deleted.
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

DO $rb_preconditions$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'media_private_photos') THEN
    RAISE EXCEPTION 'S3D-0102-RB-001: 20261029_0102 is not applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

-- The 20261029_0101 body, verbatim.
CREATE OR REPLACE FUNCTION public.post_media_resolved_for(_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, media_id uuid, width integer, height integer, mime text, url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid()); _origin text;
BEGIN
  IF _post_ids IS NULL OR array_length(_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'MEDIA-1001 at most 50 post ids per call, got %', array_length(_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  IF NOT public.feature_allowed('media_ladder_feed', _uid) THEN RETURN; END IF;
  _origin := public.media_cdn_origin();
  IF _origin IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH vis AS (
    SELECT p.id AS pid
      FROM public.posts p
     WHERE p.id = ANY(_post_ids)
       AND p.privacy = 'public'
       -- ⚠ DO NOT REMOVE. This is the access control.
       AND public.can_view_post(_uid, p.user_id, p.privacy)
  ), slides AS (
    SELECT pm.post_id AS pid, pm.ord AS o, mo.id AS mid, mo.owner_id AS own, mo.width AS w, mo.height AS h,
           (mo.state = 'ready' AND mo.derivatives ?& ARRAY['600', '1080', '1440']) AS complete
      FROM vis JOIN public.post_media pm ON pm.post_id = vis.pid
      JOIN public.media_objects mo ON mo.id = pm.media_id
  ), whole AS (
    SELECT s.pid FROM slides s GROUP BY s.pid HAVING bool_and(s.complete)
  )
  SELECT s.pid, s.o, s.mid, d.width, d.height, 'image/webp'::text,
         _origin || '/' || public.media_derivative_key(s.own, s.mid, 'public', r.x)
    FROM slides s
    JOIN whole USING (pid)
   CROSS JOIN unnest(ARRAY[600, 1080, 1440]) r(x)
   CROSS JOIN LATERAL public.media_rung_dims(s.w, s.h, r.x) d
   ORDER BY s.pid, s.o, r.x;
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_media_resolved_for(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_media_resolved_for(uuid[]) TO authenticated;

INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, feature, 'mode', mode, NULL, '20261029_0102 rollback: switch removed'
  FROM public.feature_access WHERE feature = 'media_private_photos';
DELETE FROM public.feature_access WHERE feature = 'media_private_photos';   -- members cascade

COMMIT;
