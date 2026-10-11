-- ROLLBACK for 20261011_0002_vid1_duplicate_post_media_only.sql
-- Restores the exact 20260814234152 body. Video posts then fail again as
-- "Duplicate post detected" for every second video within 10 minutes.
BEGIN;
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
DO $post$ BEGIN RAISE NOTICE 'VID-DUP-0002 ROLLBACK: detect_duplicate_post() restored to 20260814234152'; END $post$;
COMMIT;
