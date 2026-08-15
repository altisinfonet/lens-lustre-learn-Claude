-- ROLLBACK for 20260814210000_dup_post_race_fix.sql
--
-- ⚠ Restores the RACY version verbatim as it stood before the fix. Running
-- this re-opens the measured duplicate-post race: two simultaneous identical
-- submits by one member will both commit. Emergency reversion only.

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
