-- ═══════════════════════════════════════════════════════════════════════════
-- B4 FIX-1 — CLOSE THE DUPLICATE-POST RACE (measured, not theorised)
--
-- MEASURED ON THE HARNESS (2026-08-14, harness/b4/race_transcript.txt):
--   Two sessions submitting the same caption + same photos at the same moment
--   BOTH committed → 2 identical posts. The sequential control (same two
--   inserts, not overlapping) was correctly refused, so the guard itself
--   works; only the overlap defeats it.
--
-- WHY IT HAPPENS: detect_duplicate_post() reads `EXISTS (… content_hash …)`
-- and raises if it finds one. Under READ COMMITTED the second session's read
-- cannot see the first session's uncommitted row, so both read "no duplicate"
-- and both insert. Check-then-act with nothing serialising the two.
--
-- WHO HITS IT: a member double-tapping Post on a slow connection, or the same
-- composition submitted from two devices. Not adversarial — ordinary.
--
-- THE FIX: pg_advisory_xact_lock keyed on (user_id, content_hash), taken
-- BEFORE the read. Identical remedy, identical shape to the competition
-- max-entries race closed earlier today (20260814175927).
--
-- SCOPE OF THE LOCK: per member, per exact content. Two different members
-- posting the same caption never wait on each other — MEASURED at t+1152ms
-- against a session holding its own lock until t+3000ms. Transaction-scoped,
-- so it is released by COMMIT or ROLLBACK; there is no unlock path to miss.
--
-- Everything outside the PERFORM line is byte-identical to the deployed
-- function, so the diff is one statement.
-- ═══════════════════════════════════════════════════════════════════════════

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
