-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261011_0003 — publish a video post in ONE step:
-- public.video_publish_post() writes the post AND its post_videos link in one
-- transaction, so there is never a post without its video.
-- Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (Owner, staging, 2026-10-11 — "empty post on the wall", "Duplicate post
-- detected"; Owner asked for proper structure, not patches): the upload job
-- (uploadJobs.ts "ready" step) inserted the post, THEN linked the video in a
-- second request. Two consequences:
--   • between the two requests — or for ever, if the second one failed — the
--     post existed with nothing in it, and its AFTER INSERT fan-out
--     (trg_fan_out_new_post) told followers about an empty post;
--   • detect_duplicate_post() runs on the post insert, before the video is
--     linked, so it cannot see the video: two DIFFERENT videos with the same
--     caption within 10 minutes were refused as duplicates (0002's known limit).
--
-- WHAT
--   1. public.video_publish_post(_video_id, _content, _privacy, _categories,
--      _idempotency_key) RETURNS uuid (the post id). SECURITY INVOKER: it runs
--      as the member, so every existing rule still applies unchanged — the
--      posts INSERT policies (own user_id, not banned, account live), the
--      post_videos INSERT policies (own post, video_posts switch on for them,
--      account live), tg_post_videos_link_guard (READY post video, owned by
--      the post's author, 1–5 categories), the category, moderation and
--      rate-limit triggers. It grants nothing the member could not already
--      do with the two separate inserts; it only makes them all-or-nothing.
--      Idempotent by key: a replay returns the post that key already made
--      (and links the video if an older two-step publish left it unlinked).
--   2. detect_duplicate_post(): a post being written by video_publish_post()
--      for a video that is READY, owned by the author and not yet linked skips
--      the text-hash check (content_hash NULL). The marker is a
--      transaction-local setting only this function sets, and the trigger
--      re-checks the video itself, so a plain posts insert can never use it.
--      Everything else in the 0002 body is unchanged.
--
-- ROLLBACK: supabase/rollback/20261011_0003_vid1_publish_post_atomic_ROLLBACK.sql
--           (revert the client to the two-step publish FIRST).
-- PROBE:    supabase/migrations/PROBE_vid1_publish_post_atomic.sql
-- OBJECTS (reservation): public.video_publish_post(uuid,text,text,text[],text) (new);
--                        public.detect_duplicate_post() (body only).
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
  IF to_regprocedure('public.video_publish_post(uuid,text,text,text[],text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID-PUB-PRE-001: public.video_publish_post() already exists — read it before replacing';
  END IF;
  SELECT prosrc INTO _src FROM pg_proc WHERE oid = to_regprocedure('public.detect_duplicate_post()');
  -- Only replace the version we read (20261011_0002).
  IF _src IS NULL
     OR position('NEW.content_hash := NULL' IN _src) = 0
     OR position('AND idempotency_key = NEW.idempotency_key' IN _src) = 0
     OR position('pg_advisory_xact_lock(hashtextextended(NEW.user_id::text' IN _src) = 0 THEN
    RAISE EXCEPTION 'VID-PUB-PRE-002: detect_duplicate_post() is not the 20261011_0002 version — apply 0002 first';
  END IF;
  IF to_regclass('public.post_videos') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.post_videos'::regclass AND tgname = 'tg_post_videos_link_guard' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'VID-PUB-PRE-003: post_videos or its link guard is missing — apply 20261005_0005 first';
  END IF;
  -- SECURITY INVOKER relies on these: without them the function would let a
  -- member write a post as someone else.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.posts'::regclass AND polcmd = 'a'
                   AND pg_get_expr(polwithcheck, polrelid) ILIKE '%user_id = ( SELECT auth.uid()%') THEN
    RAISE EXCEPTION 'VID-PUB-PRE-004: posts has no "own user_id" INSERT policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.post_videos'::regclass AND polname = 'post_videos_insert_own') THEN
    RAISE EXCEPTION 'VID-PUB-PRE-005: post_videos_insert_own policy is missing';
  END IF;
  IF to_regclass('public.post_media') IS NULL THEN
    RAISE EXCEPTION 'VID-PUB-PRE-006: public.post_media is missing (the replay path checks it)';
  END IF;
END
$pre$;

-- ── 1. the one-step publish ────────────────────────────────────────────────
CREATE FUNCTION public.video_publish_post(_video_id uuid, _content text, _privacy text,
                                          _categories text[], _idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $fn$
DECLARE
  _uid    uuid := (SELECT auth.uid());
  _post   uuid;
  _linked uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'VID-PUB-001: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _video_id IS NULL THEN
    RAISE EXCEPTION 'VID-PUB-002: video_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'VID-PUB-002: idempotency_key must be 8–200 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- One publish per (member, key) at a time: a concurrent second call waits
  -- here and then takes the replay path below instead of failing with 23505
  -- (independent review C1).
  PERFORM pg_advisory_xact_lock(hashtextextended('video_publish_post:' || _uid::text || ':' || _idempotency_key, 0));

  -- A replay of a publish that already landed: return that post. A post left
  -- unlinked by the older two-step publish is linked now — but never a photo
  -- post: post_publish_with_media sets keys too, and a video never joins a
  -- post that already carries photographs (independent review C2).
  SELECT p.id INTO _post FROM public.posts p
   WHERE p.user_id = _uid AND p.idempotency_key = _idempotency_key;
  IF _post IS NOT NULL THEN
    SELECT pv.video_id INTO _linked FROM public.post_videos pv WHERE pv.post_id = _post;
    IF _linked IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.posts p
                  WHERE p.id = _post
                    AND (COALESCE(cardinality(p.image_urls), 0) > 0 OR COALESCE(p.image_url, '') <> ''))
         OR EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = _post) THEN
        RAISE EXCEPTION 'VID-PUB-003: this publish key belongs to a photo post' USING ERRCODE = 'unique_violation';
      END IF;
      INSERT INTO public.post_videos (post_id, video_id) VALUES (_post, _video_id);
    ELSIF _linked <> _video_id THEN
      RAISE EXCEPTION 'VID-PUB-003: this publish key already belongs to another video' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN _post;
  END IF;

  -- Read by detect_duplicate_post() for this one insert only (transaction-local).
  PERFORM set_config('vid1.publishing_video', _video_id::text, true);
  INSERT INTO public.posts (user_id, content, privacy, categories, idempotency_key)
  VALUES (_uid, coalesce(_content, ''), coalesce(_privacy, 'public'), _categories, _idempotency_key)
  RETURNING id INTO _post;
  PERFORM set_config('vid1.publishing_video', '', true);

  -- The link guard and RLS refuse anything wrong here — and the post above
  -- goes with it: one transaction.
  INSERT INTO public.post_videos (post_id, video_id) VALUES (_post, _video_id);
  RETURN _post;
END;
$fn$;

REVOKE ALL ON FUNCTION public.video_publish_post(uuid, text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_publish_post(uuid, text, text, text[], text) TO authenticated;

COMMENT ON FUNCTION public.video_publish_post(uuid, text, text, text[], text) IS
  'VID-1 20261011_0003: post + post_videos link in one transaction, as the member (SECURITY INVOKER). Idempotent by key.';

-- ── 2. the duplicate guard knows a video publish ───────────────────────────
CREATE OR REPLACE FUNCTION public.detect_duplicate_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hash_val text;
  dupe_exists boolean;
  pub text;
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

  -- VID-1 (20261011_0003): written by video_publish_post() for a video that is
  -- READY, the author's own and not yet linked — the same caption on two
  -- different videos is two posts. The marker is set only by that function,
  -- for its one insert; the video itself is re-checked here regardless.
  pub := NULLIF(current_setting('vid1.publishing_video', true), '');
  IF pub IS NOT NULL
     AND pub ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND EXISTS (SELECT 1 FROM public.videos v
                  WHERE v.id = pub::uuid AND v.owner_id = NEW.user_id
                    AND v.state = 'ready' AND v.purpose = 'post')
     AND NOT EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = pub::uuid) THEN
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
DECLARE _p record;
BEGIN
  SELECT prosecdef, proconfig INTO _p FROM pg_proc WHERE oid = 'public.video_publish_post(uuid,text,text,text[],text)'::regprocedure;
  IF _p.prosecdef THEN
    RAISE EXCEPTION 'VID-PUB-POST-001: video_publish_post must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.video_publish_post(uuid,text,text,text[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VID-PUB-POST-002: anon can execute video_publish_post';
  END IF;
  RAISE NOTICE 'VID-PUB-0003: video_publish_post() (post + link, one transaction, as the member); duplicate guard skips a verified video publish';
END
$post$;

COMMIT;
