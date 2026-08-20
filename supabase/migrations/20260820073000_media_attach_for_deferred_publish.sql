-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFERRED PUBLISH PATHS GET MEDIA TOO — DRAFTS AND SCHEDULED POSTS.
--
-- 20260820061500 closed the immediate composer: a post published by pressing
-- Post now carries `post_media` rows. Two paths still produce `image_urls`-only
-- posts, and both are live (3 drafts and 1 scheduled post outstanding on
-- 2026-08-20, and every one of them WILL become a post):
--
--   post_drafts     → publish_post_draft()          , run by the member
--   scheduled_posts → publish-scheduled-posts (edge), run hours later with NO
--                     member, no session, and no auth.uid()
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY NOT `post_publish_with_media` FOR THESE
--
-- That function CREATES the post and derives `image_urls` from the media rows.
-- Here the row already exists (a draft the member has been editing, a
-- scheduled row written days ago) and `image_urls` is authoritative — it is
-- what the member saw in the composer and what the scheduled row promised.
-- Deriving it again would be a second source of truth for the same fact.
--
-- So this is the mirror image: the post is inserted exactly as it is today, and
-- `post_attach_media` then attaches references — but ONLY if it can prove the
-- media rows describe THE PHOTOGRAPHS THIS POST ACTUALLY SHOWS.
--
-- ⚠ MEDIA-2205 IS THE WHOLE POINT. Ownership and readiness are necessary and
-- nowhere near sufficient: a member with two ready photographs could otherwise
-- attach the wrong one, and the feed would show a different picture from every
-- other surface. So each media object's stored path, prefixed with the delivery
-- origin, must EQUAL `image_urls[ord]`. If they disagree by one character the
-- whole attach is refused and the post stays legacy — visibly unmigrated, which
-- is a state the reconciliation already understands, rather than quietly wrong.
--
-- ───────────────────────────────────────────────────────────────────────────
-- IT CANNOT COST A MEMBER THEIR POST
--
-- Both callers wrap the attach in a sub-block that swallows failure, exactly as
-- `publish_post_draft` already does for people-tags. A refused attach leaves
-- the post published and legacy-only. That is the correct trade: a photographer
-- who scheduled a post for 7am must get their post at 7am, and a media
-- reference is not worth a missed publication.
--
-- Because PL/pgSQL's BEGIN…EXCEPTION is a subtransaction, a refusal rolls back
-- the WHOLE attach. Half a carousel — the ord gap the completeness gate exists
-- to prevent — is not reachable.
--
-- WHAT IS NOT CLOSED HERE, AND WHY (not an oversight):
--   MyPhotos album posts upload to `avatars/<uid>/my-photos/…` and
--   profilePostHelper posts the member's `avatars/<uid>/avatar.webp?t=…`.
--   Those are Priority-2 classes C and D: the wrong bucket prefix, and a
--   MUTABLE path that is overwritten on every profile-photo change and so
--   cannot carry stable content identity at all. `media_mark_ready` refuses
--   both today (MEDIA-2102). Closing them needs the class C/D decision, not a
--   patch here. There are 3 such posts in all of production.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- The media the member's client has already registered for this row. NULL and
-- '{}' both mean "no media engine involvement" — the row publishes legacy,
-- exactly as it does today.
ALTER TABLE public.post_drafts     ADD COLUMN IF NOT EXISTS media_ids uuid[];
ALTER TABLE public.scheduled_posts ADD COLUMN IF NOT EXISTS media_ids uuid[];

COMMENT ON COLUMN public.post_drafts.media_ids IS
  'media_objects the composer registered when these photographs were uploaded. '
  'Attached to the post by publish_post_draft via post_attach_media. NULL means '
  'the draft predates the media write path and publishes legacy-only.';
COMMENT ON COLUMN public.scheduled_posts.media_ids IS
  'As post_drafts.media_ids. Read by publish-scheduled-posts, which runs with '
  'no member and therefore cannot re-derive ownership from auth.uid().';

CREATE OR REPLACE FUNCTION public.post_attach_media(_post_id uuid, _media_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n       int;
  _bad     int;
  _author  uuid;
  _slides  text[];
  _origin  text;
BEGIN
  IF _media_ids IS NULL OR array_length(_media_ids, 1) IS NULL THEN
    RETURN 0;               -- nothing offered; the post stays legacy
  END IF;
  _n := array_length(_media_ids, 1);

  -- The author comes from the POST, never from the caller. The scheduled
  -- publisher runs as service_role with no session, so there is no auth.uid()
  -- to fall back on and nothing here may be taken on trust.
  SELECT user_id, coalesce(image_urls, '{}') INTO _author, _slides
  FROM public.posts WHERE id = _post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA-2200 post % does not exist', _post_id USING ERRCODE = '23503';
  END IF;

  IF EXISTS (SELECT 1 FROM public.post_media WHERE post_id = _post_id) THEN
    RAISE EXCEPTION 'MEDIA-2203 post % already has media references', _post_id
      USING ERRCODE = '23505';
  END IF;

  IF (SELECT count(*) FROM (SELECT DISTINCT unnest(_media_ids) m) d) <> _n THEN
    RAISE EXCEPTION 'MEDIA-2202 the same photograph appears more than once'
      USING ERRCODE = '22023';
  END IF;

  -- Whole post or nothing. A post carrying three photographs and two references
  -- is the ord gap every other gate in this engine exists to prevent.
  IF coalesce(array_length(_slides, 1), 0) <> _n THEN
    RAISE EXCEPTION 'MEDIA-2204 post % shows % photographs, % media offered',
      _post_id, coalesce(array_length(_slides, 1), 0), _n USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO _bad
  FROM unnest(_media_ids) AS m(id)
  LEFT JOIN public.media_objects mo ON mo.id = m.id
  WHERE mo.id IS NULL OR mo.owner_id <> _author OR mo.state <> 'ready';

  IF _bad > 0 THEN
    RAISE EXCEPTION 'MEDIA-2201 % of % media are missing, not the author''s, or not ready',
      _bad, _n USING ERRCODE = '42501';
  END IF;

  SELECT value->>'public_url' INTO _origin
  FROM public.site_settings WHERE key = 's3_storage_settings';
  IF _origin IS NULL OR _origin = '' THEN
    RAISE EXCEPTION 'MEDIA-2110 s3_storage_settings.public_url is not configured'
      USING ERRCODE = '22023';
  END IF;
  _origin := rtrim(_origin, '/');

  -- ⚠ THE CHECK THAT MAKES THIS SAFE. Ownership and readiness would happily
  -- accept the member's OTHER photographs. Each media object must resolve to
  -- the exact URL this post is already showing at that position.
  SELECT count(*) INTO _bad
  FROM unnest(_media_ids) WITH ORDINALITY AS t(mid, ord)
  JOIN public.media_objects mo ON mo.id = t.mid
  WHERE _origin || '/' || (mo.derivatives->>'original') IS DISTINCT FROM _slides[t.ord];

  IF _bad > 0 THEN
    RAISE EXCEPTION 'MEDIA-2205 % of % media do not resolve to the photographs this post shows',
      _bad, _n USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.post_media (post_id, ord, media_id)
  SELECT _post_id, ord - 1, mid
  FROM unnest(_media_ids) WITH ORDINALITY AS t(mid, ord);

  SELECT count(*) INTO _bad FROM public.post_media WHERE post_id = _post_id;
  IF _bad <> _n THEN
    RAISE EXCEPTION 'MEDIA-2206 attach aborted: % of % references landed', _bad, _n
      USING ERRCODE = '23514';
  END IF;

  RETURN _n;
END $function$;

REVOKE ALL ON FUNCTION public.post_attach_media(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_attach_media(uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.post_attach_media(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.post_attach_media(uuid, uuid[]) IS
  'Attach post_media references to a post that already exists, all or nothing. '
  'The author is read from the post; every media object must be that author''s, '
  'ready, and resolve to the exact URL the post already shows at that position '
  '(MEDIA-2205). service_role only; SECURITY DEFINER callers reach it as owner.';

-- ── publish_post_draft: attach after the post exists, never at its cost ────
CREATE OR REPLACE FUNCTION public.publish_post_draft(_draft_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d   public.post_drafts%ROWTYPE;
  _post_id uuid;
  _t   jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH-0001: sign-in required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the row so two taps of Publish cannot both proceed.
  SELECT * INTO _d FROM public.post_drafts
   WHERE id = _draft_id AND user_id = _uid AND expiring_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT-003: draft not found, not yours, or expired'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- post_kind is set explicitly. Inside a SECURITY DEFINER function
  -- current_user is the owner, so enforce_post_categories() does NOT treat this
  -- as a client insert and will not pin post_kind for us. A published draft is
  -- a member post - a person wrote it - so it must say so.
  INSERT INTO public.posts (
    user_id, content, image_url, image_urls, thumbnail_urls,
    privacy, indexing_disabled, categories, post_kind
  ) VALUES (
    _uid, _d.content, _d.image_url, _d.image_urls, _d.thumbnail_urls,
    _d.privacy, _d.indexing_disabled, _d.categories, 'member'
  )
  RETURNING id INTO _post_id;

  -- ── Media references. Same guarded shape as the people-tags block below,
  -- and for the same reason: a refused attach must never cost the member the
  -- post they just published. The sub-transaction makes it all-or-nothing, so
  -- a partial carousel is not reachable. A failure here leaves the post
  -- legacy-only, which the reconciliation already reports.
  BEGIN
    PERFORM public.post_attach_media(_post_id, _d.media_ids);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'DRAFT-005: media references not attached to post %: %', _post_id, SQLERRM;
  END;

  -- People-tags. Wrapped so a malformed tag can never cost the member their
  -- post: that is exactly how the direct posting path behaves today (it logs
  -- POST-2005 and carries on), and publishing must not be stricter.
  BEGIN
    FOR _t IN SELECT * FROM jsonb_array_elements(COALESCE(_d.pending_tags, '[]'::jsonb))
    LOOP
      INSERT INTO public.post_tags (
        post_id, tagger_id, tagged_user_id, photo_index, x_position, y_position
      ) VALUES (
        _post_id, _uid,
        (_t->>'taggedUserId')::uuid,
        COALESCE((_t->>'photoIndex')::int, 0),
        COALESCE((_t->>'xPosition')::numeric, 0),
        COALESCE((_t->>'yPosition')::numeric, 0)
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'DRAFT-004: people-tags skipped for post %: %', _post_id, SQLERRM;
  END;

  -- The draft row goes. Its IMAGES DO NOT - the post now references those very
  -- URLs. Deleting them here would blank the post that was just created.
  DELETE FROM public.post_drafts WHERE id = _draft_id;

  RETURN _post_id;
END $function$;

REVOKE ALL ON FUNCTION public.publish_post_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid) TO authenticated;

COMMIT;
