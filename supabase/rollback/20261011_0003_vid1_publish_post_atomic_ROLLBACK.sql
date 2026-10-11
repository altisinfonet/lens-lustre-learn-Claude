-- ROLLBACK for 20261011_0003_vid1_publish_post_atomic.sql
-- ⚠ Revert the client to the two-step publish (uploadJobs.ts insertPost +
-- insertPostVideo) BEFORE running this: with the function gone, every video
-- publish from the new client fails.
-- Drops video_publish_post() and restores the exact 20261011_0002 body of
-- detect_duplicate_post().
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.video_publish_post(uuid, text, text, text[], text);

CREATE OR REPLACE FUNCTION public.detect_duplicate_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hash_val text;
  dupe_exists boolean;
BEGIN
  -- VID-1 (20261011_0002): a post with no text and no photos is media-only —
  -- a video post, whose video is linked in post_videos right after this insert.
  -- All such posts would share one hash, so the check below refused every second
  -- video post within 10 minutes. Skip it; duplicate videos are prevented by the
  -- upload's idempotency key, and trg_rate_limit_posts still limits volume.
  IF btrim(COALESCE(NEW.content, '')) = ''
     AND COALESCE(cardinality(NEW.image_urls), 0) = 0
     AND COALESCE(NEW.image_url, '') = '' THEN
    NEW.content_hash := NULL;
    RETURN NEW;
  END IF;

  -- Generate hash from content + image URLs
  hash_val := md5(
    COALESCE(NEW.content, '') || '|' ||
    COALESCE(array_to_string(NEW.image_urls, ','), '') || '|' ||
    COALESCE(NEW.image_url, '')
  );

  NEW.content_hash := hash_val;

  -- Serialise check-then-insert for THIS member and THIS content only.
  -- Without it, the read below is of a snapshot a concurrent submit cannot
  -- appear in, and both submits pass the guard (measured: 2 rows).
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || hash_val, 0));

  -- VID-1 (20261011_0002): a replay of an insert that already landed (same
  -- member, same idempotency key) is let through to posts_user_idempotency_key,
  -- whose 23505 the client reads back as "already posted". Without this a
  -- captioned retry was refused here as a duplicate of ITSELF and its video was
  -- never linked. Checked after the lock, so a concurrent first insert of the
  -- same content has committed and is visible. Not a bypass: the row exists,
  -- so the unique index refuses this insert anyway.
  IF NEW.idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.posts
    WHERE user_id = NEW.user_id
      AND idempotency_key = NEW.idempotency_key
  ) THEN
    RETURN NEW;
  END IF;

  -- Check for duplicate by same user within 10 minutes
  SELECT EXISTS (
    SELECT 1 FROM public.posts
    WHERE user_id = NEW.user_id
      AND content_hash = hash_val
      AND created_at > now() - interval '10 minutes'
  ) INTO dupe_exists;

  IF dupe_exists THEN
    RAISE EXCEPTION 'Duplicate post detected. Please wait before posting similar content.';
  END IF;

  RETURN NEW;
END;
$function$;

DO $post$ BEGIN RAISE NOTICE 'VID-PUB-0003 ROLLBACK: video_publish_post() dropped; detect_duplicate_post() restored to 20261011_0002'; END $post$;
COMMIT;
