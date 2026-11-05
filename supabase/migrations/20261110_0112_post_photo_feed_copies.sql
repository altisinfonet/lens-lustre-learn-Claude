-- ═══════════════════════════════════════════════════════════════════════════
-- Photo speed · 20261110_0112 — the FEED COPIES of old photos (lookup only).
-- Lanes: staging and production. Expand only: one read function, nothing else.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (Owner, 5 Nov 2026: "photo must come in App less than 1 sec"): an old
-- feed photo (posted before the photo plan, no set marker in its name) has no
-- phone-size copy the feed can derive from its name, so the feed downloads the
-- full original (0.45–4.4 MB measured on live). The backfill (20261110_0101,
-- photo_set_backfill) already stored a CLEAN 1080 (`-l4-r1080`, only when the
-- long edge is over 1080) and a 600 (`-l4-thumb`) beside 598 of them on 3 Nov,
-- never shown. This lookup names them, so the feed shows ~130 KB instead of
-- the original. No file is written, no row is changed, posts are not touched.
--
-- OBJECT:
--   public.post_photo_feed_copies(post_ids uuid[]) → (post_id, ord, src_url, feed_url, thumb_url)
--     · anon + authenticated, SECURITY DEFINER, search_path '';
--     · only posts the caller can view (can_view_post — the same gate as
--       post_photo_credit_for, 0109) and only while the post still shows that
--       exact photo at that place (image_urls[ord+1] = old_url);
--     · feed_url = the clean `-l4-r1080` sibling when the set's long edge is
--       over 1080, else NULL (the original is then ≤ 1080 itself); NEVER the
--       `-l4` master (it carries the retired v2 credit);
--     · thumb_url = the clean `-l4-thumb` (600);
--     · at most 50 ids per call (PHOTO-FC-001).
--
-- NOT RE-RUNNABLE: PRE-002 refuses once the function exists.
-- ROLLBACK: supabase/rollback/20261110_0112_post_photo_feed_copies_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0112_post_photo_feed_copies.sql (FAIL before, PASS after)
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
  IF to_regclass('public.photo_set_backfill') IS NULL OR to_regclass('public.posts') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'FC-0112-PRE-001: photo_set_backfill (0101), posts, can_view_post(uuid,uuid,text) or auth.uid is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regprocedure('public.post_photo_feed_copies(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'FC-0112-PRE-002: post_photo_feed_copies already exists — 20261110_0112 is applied';
  END IF;
END
$pre$;

CREATE FUNCTION public.post_photo_feed_copies(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, src_url text, feed_url text, thumb_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-FC-001: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT b.post_id, b.ord, b.old_url,
         CASE WHEN greatest(
                (regexp_match(b.new_url, '-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp$'))[1]::int,
                (regexp_match(b.new_url, '-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp$'))[2]::int) > 1080
              THEN regexp_replace(b.new_url, '-l4\.webp$', '-l4-r1080.webp')
              ELSE NULL END,
         b.new_thumb
    FROM public.photo_set_backfill b
    JOIN public.posts p ON p.id = b.post_id
   WHERE b.post_id = ANY (p_post_ids)
     -- ⚠ DO NOT REMOVE. This is the access control (as post_photo_credit_for).
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     -- only while the post still shows exactly that photo at that place
     AND p.image_urls[b.ord + 1] = b.old_url
   ORDER BY b.post_id, b.ord;
END;
$fn$;
REVOKE ALL ON FUNCTION public.post_photo_feed_copies(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_feed_copies(uuid[]) TO anon, authenticated;
COMMENT ON FUNCTION public.post_photo_feed_copies(uuid[]) IS
  'Photo speed 0112: the clean feed copies (-l4-r1080 when long edge > 1080, -l4-thumb) stored beside OLD photos by the '
  'backfill (0101), for posts the caller can view (can_view_post), only while the post still names the photo. '
  'Never the -l4 master. At most 50 ids (PHOTO-FC-001).';

DO $post$
DECLARE _n bigint; _r bigint;
BEGIN
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.post_photo_feed_copies(uuid[])')) THEN
    RAISE EXCEPTION 'FC-0112-POST-001: post_photo_feed_copies is not SECURITY DEFINER';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE greatest(
           (regexp_match(b.new_url, '-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp$'))[1]::int,
           (regexp_match(b.new_url, '-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp$'))[2]::int) > 1080)
    INTO _n, _r
    FROM public.photo_set_backfill b JOIN public.posts p ON p.id = b.post_id
   WHERE p.image_urls[b.ord + 1] = b.old_url;
  RAISE NOTICE 'FC-0112 applied on %: % old photo(s) with a recorded set, % with a clean 1080', current_setting('p32.lane'), _n, _r;
END
$post$;

COMMIT;
