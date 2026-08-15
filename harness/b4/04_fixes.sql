-- ═══════════════════════════════════════════════════════════════════════════
-- B4 FIXES — applied to the HARNESS first. Two migrations, proven separately.
--
-- FIX-1 (LIVE DEFECT, RACE-1): detect_duplicate_post reads then raises with
--   nothing serialising the two. Two devices — or one member double-tapping
--   Post on a slow connection — both read "no duplicate", both insert, and the
--   member gets two identical posts. The sequential control (RACE-1b) proves
--   the guard itself works; only the overlap defeats it. Same shape, same
--   remedy as the competition max-entries race closed earlier today:
--   pg_advisory_xact_lock keyed on (user, content hash), taken BEFORE the read.
--   The key is per-member-per-content, so two different members, or the same
--   member posting different photos, never wait on each other.
--
-- FIX-2 (LATENT, RACE-3 + R16): a takedown landing while a publish is in
--   flight leaves a live post referencing quarantined bytes. Two halves:
--     a) tg_post_media_requires_ready reads the media row FOR UPDATE, so the
--        publish and the quarantine are ordered instead of interleaved. When
--        the quarantine wins the race, the publish then sees 'quarantined'
--        and is refused.
--     b) media_quarantine detaches live references in the same transaction —
--        a takedown that leaves the photo on the post is not a takedown. When
--        the publish wins the race, the quarantine cleans up after it.
--     c) UNIQUE (post_id, media_id): the gate's "no duplicate reference"
--        clause, enforced rather than assumed (R16 showed the same photo can
--        currently occupy two positions in one carousel).
--   These touch tables with ZERO production rows (media engine ships at B5),
--   so the change is inert until the client switch.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── FIX-1 ──
CREATE OR REPLACE FUNCTION public.detect_duplicate_post() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  hash_val text;
  dupe_exists boolean;
BEGIN
  hash_val := md5(
    COALESCE(NEW.content, '') || '|' ||
    COALESCE(array_to_string(NEW.image_urls, ','), '') || '|' ||
    COALESCE(NEW.image_url, '')
  );

  NEW.content_hash := hash_val;

  -- Serialise the check-then-insert for THIS member and THIS content only.
  -- Without it the guard below is a read of a snapshot that a concurrent
  -- submit cannot appear in, and both submits pass it (measured: 2 rows).
  -- Transaction-scoped: released at COMMIT/ROLLBACK, no unlock path to miss.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || hash_val, 0));

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

-- ── FIX-2a ──
CREATE OR REPLACE FUNCTION public.tg_post_media_requires_ready() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _state text;
BEGIN
  -- FOR UPDATE: a concurrent quarantine of this media must queue behind this
  -- publish rather than run through the middle of it. Whichever lands first,
  -- the other sees a settled state instead of a stale one.
  SELECT state INTO _state FROM public.media_objects WHERE id = NEW.media_id FOR UPDATE;
  IF _state IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'post_media: media % is in state %, only ready may be referenced',
      NEW.media_id, coalesce(_state, '<missing>')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

-- ── FIX-2b ──
CREATE OR REPLACE FUNCTION public.media_quarantine(_id uuid, _reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _detached int;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'a quarantine must record a reason' USING ERRCODE = '22023';
  END IF;

  UPDATE public.media_objects
     SET state = 'quarantined', quarantine_reason = _reason
   WHERE id = _id AND state <> 'quarantined';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % does not exist or is already quarantined', _id
      USING ERRCODE = '23514';
  END IF;

  -- A takedown that leaves the photo on the post is not a takedown. If a
  -- publish committed while this quarantine was in flight, its reference is
  -- removed here, in the same transaction that took the media down.
  DELETE FROM public.post_media WHERE media_id = _id;
  GET DIAGNOSTICS _detached = ROW_COUNT;
  IF _detached > 0 THEN
    RAISE NOTICE 'quarantine of % detached % live reference(s)', _id, _detached;
  END IF;
END $function$;

-- ── FIX-2c ──
CREATE UNIQUE INDEX IF NOT EXISTS post_media_post_media_uniq
  ON public.post_media USING btree (post_id, media_id);

SELECT 'B4 FIXES APPLIED TO HARNESS' AS ok;
