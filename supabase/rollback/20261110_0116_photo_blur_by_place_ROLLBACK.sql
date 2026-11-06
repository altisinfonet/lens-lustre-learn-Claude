-- ROLLBACK · 20261110_0116 → the 0115 shape of post_photo_blurs (post_id, url, hash).
-- The card then matches by address only (draws fewer codes, never a wrong one).
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.post_photo_blurs(uuid[]);

CREATE FUNCTION public.post_photo_blurs(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, url text, hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-BL-001: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT DISTINCT p.id, b.url, b.hash
    FROM public.posts p
   CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[]) || coalesce(ARRAY[p.image_url], '{}'::text[])) AS u(src)
    JOIN public.photo_blur b ON b.url = u.src
   WHERE p.id = ANY (p_post_ids)
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     AND b.hash IS NOT NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.post_photo_blurs(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_blurs(uuid[]) TO anon, authenticated;

DO $post$
BEGIN
  RAISE NOTICE 'BL-0116 rolled back on %: post_photo_blurs is the 0115 shape again', current_setting('p32.lane');
END
$post$;

COMMIT;
