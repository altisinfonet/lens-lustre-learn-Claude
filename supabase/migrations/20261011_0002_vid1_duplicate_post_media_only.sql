-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261011_0002 — the duplicate-post guard no longer refuses
-- media-only posts (video posts).
-- Lanes: staging and production. Replaces the body of
-- public.detect_duplicate_post() last set by 20260814234152_dup_post_race_fix.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SYMPTOM (Owner, staging, 2026-10-11 12:24 UTC): "Your video couldn't be
-- posted — Duplicate post detected. Please wait before posting similar
-- content." The video itself was uploaded and READY (708def6d…); only its post
-- row was refused (postgres log, same second).
--
-- CAUSE: the guard hashes content + image_urls + image_url and refuses a second
-- post with the same hash by the same member within 10 minutes. A video post
-- is inserted with no text and no photos (the video is linked in post_videos
-- right after the insert, uploadJobs.ts "ready" step), so EVERY video post has
-- the same hash and every second one within 10 minutes is refused.
--
-- FIX: a post with no text (after trimming) and no photos is media-only; skip
-- the hash check for it and store content_hash NULL (so it can never collide
-- with a text/photo post either). Duplicate VIDEOS are already prevented by the
-- upload's idempotency key (video_begin_upload) and post_videos' unique link;
-- spam volume is limited by trg_rate_limit_posts, which is unchanged. Text and
-- photo posts behave exactly as before (same hash, lock and 10-minute window),
-- with one addition: a REPLAY (a row with the same user_id + idempotency_key
-- already exists) skips the window check so it reaches the unique index and
-- fails as 23505, which uploadJobs.ts reads back as "already posted"
-- (independent review, MEDIUM: a captioned video retry was refused as a
-- duplicate of itself and its video was never linked). post_publish_with_media
-- looks the key up BEFORE inserting, so for photos only two simultaneous calls
-- with one key reach this path; the second now gets 23505 instead of P0001.
--
-- KNOWN LIMIT (unchanged behaviour): two DIFFERENT videos posted with the SAME
-- caption within 10 minutes — the second is refused, exactly as the same text
-- posted twice is today. The guard runs before the video is linked and cannot
-- see it; the proper fix is an atomic publish-with-video RPC (later unit).
--
-- Body otherwise byte-for-byte the 20260814234152 version (SECURITY DEFINER,
-- search_path public, advisory lock). The trigger is unchanged.
--
-- ROLLBACK: supabase/rollback/20261011_0002_vid1_duplicate_post_media_only_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_vid1_duplicate_post_media_only.sql
-- OBJECTS (reservation): public.detect_duplicate_post() (body only).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE _src text;
BEGIN
  IF to_regprocedure('public.detect_duplicate_post()') IS NULL THEN
    RAISE EXCEPTION 'VID-DUP-PRE-001: public.detect_duplicate_post() does not exist';
  END IF;
  SELECT prosrc INTO _src FROM pg_proc WHERE oid = 'public.detect_duplicate_post()'::regprocedure;
  -- Only replace the version we read (the 20260814234152 race fix).
  IF position('pg_advisory_xact_lock(hashtextextended(NEW.user_id::text' IN _src) = 0
     OR position('Duplicate post detected' IN _src) = 0 THEN
    RAISE EXCEPTION 'VID-DUP-PRE-002: detect_duplicate_post() is not the 20260814234152 version — read it before replacing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.posts'::regclass AND tgname = 'trg_detect_duplicate_post') THEN
    RAISE EXCEPTION 'VID-DUP-PRE-003: trg_detect_duplicate_post is not attached to public.posts';
  END IF;
  -- The replay pass-through below relies on this index refusing the insert.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.posts'::regclass AND c.relname = 'posts_user_idempotency_key'
      AND i.indisunique AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'VID-DUP-PRE-004: unique index posts_user_idempotency_key is missing or invalid';
  END IF;
END
$pre$;

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

DO $post$
BEGIN
  RAISE NOTICE 'VID-DUP-0002: detect_duplicate_post() skips media-only posts (no text, no photos) and replays (same idempotency key); text/photo window unchanged';
END
$post$;

COMMIT;
