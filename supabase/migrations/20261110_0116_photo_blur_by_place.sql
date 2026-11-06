-- ═══════════════════════════════════════════════════════════════════════════
-- Photo blur · 20261110_0116 — the card's read names each code's PLACE in the post.
-- Lanes: staging and production. Replaces one read function; nothing else.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (measured on staging 6 Nov 2026 after 0115): the card draws a post's
-- photos from the media graph (post_media_for, src/lib/media/postMediaRead.ts),
-- and that address can differ from posts.image_urls for the SAME photo (staging
-- post f1263897…: the card shows `…-w1122h1402-l3.webp`, image_urls holds
-- `…-w1122h1402-l3-w864h1080-l5.webp`). The codes are filed by image_urls, so
-- matching by address drew nothing. Both lists are aligned by index (one photo
-- per place — postMediaRead.ts), so the read now also returns `ord` (0-based
-- place in image_urls) and the card matches by place.
--
-- OBJECT (replaced; same name, same argument, same access control):
--   public.post_photo_blurs(uuid[]) → (post_id, ord, url, hash)
--     · anon + authenticated, SECURITY DEFINER, search_path '';
--     · only posts the caller can view (can_view_post), only photos the post
--       shows now: image_urls[ord + 1], or the legacy image_url as place 0 of a
--       post with no image_urls; at most 50 ids (PHOTO-BL-001).
--   The return type changes, so it is dropped and created in one transaction.
--
-- NOT RE-RUNNABLE: PRE-002 refuses once the function returns `ord`.
-- ROLLBACK: supabase/rollback/20261110_0116_photo_blur_by_place_ROLLBACK.sql (the 0115 shape)
-- PROBE:    supabase/migrations/PROBE_20261110_0116_photo_blur_by_place.sql (FAIL before, PASS after)
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
  -- PRE-001 · 0115 is applied.
  IF to_regclass('public.photo_blur') IS NULL OR to_regprocedure('public.post_photo_blurs(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'BL-0116-PRE-001: 20261110_0115 (photo_blur, post_photo_blurs) is not applied';
  END IF;
  -- PRE-002 · not applied already.
  IF 'ord' = ANY ((SELECT p.proargnames FROM pg_proc p WHERE p.oid = to_regprocedure('public.post_photo_blurs(uuid[])'))) THEN
    RAISE EXCEPTION 'BL-0116-PRE-002: post_photo_blurs already returns ord — 20261110_0116 is applied';
  END IF;
END
$pre$;

DROP FUNCTION public.post_photo_blurs(uuid[]);

CREATE FUNCTION public.post_photo_blurs(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, url text, hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-BL-001: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT p.id, (u.o - 1)::integer, b.url, b.hash
    FROM public.posts p
   CROSS JOIN LATERAL unnest(CASE WHEN cardinality(coalesce(p.image_urls, '{}'::text[])) > 0 THEN p.image_urls
                                  ELSE coalesce(ARRAY[p.image_url], '{}'::text[]) END) WITH ORDINALITY AS u(src, o)
    JOIN public.photo_blur b ON b.url = u.src
   WHERE p.id = ANY (p_post_ids)
     -- ⚠ DO NOT REMOVE. This is the access control (as post_photo_feed_copies, 0112).
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     AND b.hash IS NOT NULL
   ORDER BY p.id, u.o;
END;
$fn$;
REVOKE ALL ON FUNCTION public.post_photo_blurs(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_blurs(uuid[]) TO anon, authenticated;
COMMENT ON FUNCTION public.post_photo_blurs(uuid[]) IS
  'Photo blur 0116: the ThumbHash of each photo a post shows now, with its place (ord, 0-based in image_urls), '
  'for posts the caller can view (can_view_post). At most 50 ids (PHOTO-BL-001).';

DO $post$
BEGIN
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.post_photo_blurs(uuid[])')) THEN
    RAISE EXCEPTION 'BL-0116-POST-001: post_photo_blurs is not SECURITY DEFINER';
  END IF;
  IF NOT has_function_privilege('anon', 'public.post_photo_blurs(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'BL-0116-POST-002: anon cannot run post_photo_blurs';
  END IF;
  RAISE NOTICE 'BL-0116 applied on %: post_photo_blurs returns (post_id, ord, url, hash)', current_setting('p32.lane');
END
$post$;

COMMIT;
