-- ═══════════════════════════════════════════════════════════════════════════
-- THE LIVE MEDIA WRITE PATH. Phase 2 closure, Priority 1.
--
-- The trace in docs/WRITE_PATH.md establishes that the server-side machine was
-- already complete and already deployed, and that nothing walked through it.
-- This migration does two things and nothing else:
--
--   1. `media_mark_ready` refuses an `original` outside the owner's folder.
--   2. `post_publish_with_media` DUAL-WRITES the legacy arrays.
--
-- ───────────────────────────────────────────────────────────────────────────
-- (1) WHY mark_ready GAINS AN OWNERSHIP CHECK
--
-- The live path cannot derive the storage key from the row, because production
-- does not store objects that way: all 229 rows live at
-- `post-images/<owner>/posts/<name>-w{W}h{H}[-l3].webp`, the layout the
-- uploader has always written and the one the responsive ladder is parsed
-- from. Zero rows use `media/<id>/original.*`. Measured, not assumed —
-- deploying `media-verify-upload` unchanged would look for an object that does
-- not exist and strand every upload at `pending`.
--
-- So the path arrives from the caller. `media-register-upload` checks it
-- belongs to the owner, but a check that lives only in an edge function is a
-- check that the next edge function forgets. It belongs here too, where every
-- writer passes: the migration engine, the live path, and anything later.
--
-- This is a STRENGTHENING. The 229 existing rows are already `ready` and are
-- not re-marked; `media_migrate_post` already enforces the same invariant at
-- `MIG-2006`. Nothing that was legal yesterday becomes illegal today.
--
-- ───────────────────────────────────────────────────────────────────────────
-- (2) WHY THE DUAL-WRITE EXISTS, AND HOW IT ENDS
--
-- The shipped version wrote `image_urls = '{}'`. Publishing that today blanks
-- the photograph in the ANDROID APP — a separately released binary, in
-- members' hands, that reads `posts.image_urls` and cannot be updated from
-- this repository — and in the six repo consumers Item E did not switch, and
-- in EVERY thumbnail, because `thumbnail_urls` has no representation in
-- `media_objects` at all.
--
-- So both arrays are written, and neither is trusted:
--
--   image_urls[i]      DERIVED here from media_objects.derivatives->>'original'
--                      of the media at ord = i. The caller cannot supply it,
--                      so publishing media A while displaying URL B is not
--                      expressible.
--   thumbnail_urls[i]  SUPPLIED but CONSTRAINED: each value must equal the
--                      derived original, or that original with `-thumb`
--                      inserted before the extension. `-thumb` is a filename
--                      convention and the documented fallback reuses the
--                      full-size URL when thumbnail encoding fails, so it
--                      cannot be derived — but it can be bounded to exactly
--                      those two honest possibilities.
--
-- Removal conditions are D-004 in docs/DECISIONS.md, pinned by
-- src/__tests__/mediaWritePath.test.ts. Do not delete this dual-write because
-- it looks redundant in a diff. It is load-bearing for a binary this
-- repository cannot deploy.
--
-- ⚠ EVERY PROPERTY OF THE SHIPPED FUNCTION IS PRESERVED: ords generated from
-- WITH ORDINALITY (R15), the completeness gate AFTER insertion, the
-- idempotency short-circuit BEFORE any write, ownership + readiness checked as
-- a set, no repeats, the 10-photograph cap, and the revoke from PUBLIC/anon.
-- `src/__tests__/publishAtomicity.test.ts` resolves the LAST definition across
-- migrations, so this file is now what it checks.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Ownership of the stored object, enforced where every writer passes ──

CREATE OR REPLACE FUNCTION public.media_mark_ready(_id uuid, _derivatives jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _bad   text;
  _owner uuid;
  _orig  text;
BEGIN
  IF _derivatives IS NULL OR jsonb_typeof(_derivatives) <> 'object'
     OR NOT (_derivatives ? 'original') THEN
    RAISE EXCEPTION 'derivatives must be an object containing at least "original"'
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(k, ',') INTO _bad
  FROM jsonb_object_keys(_derivatives) k
  WHERE k NOT IN ('original', '1440', '1080', '600');

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'unknown derivative rung(s): % (allowed: original,1440,1080,600)', _bad
      USING ERRCODE = '22023';
  END IF;

  SELECT owner_id INTO _owner FROM public.media_objects WHERE id = _id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'MEDIA-2101 media % does not exist', _id USING ERRCODE = '23503';
  END IF;

  _orig := _derivatives->>'original';

  -- ⚠ DO NOT REMOVE. The object a row is marked ready against must live inside
  -- that row's owner's folder. Without this, a writer that accepts a path from
  -- its caller can mark a member's row ready against somebody else's
  -- photograph, and every verification that came before becomes meaningless.
  IF _orig IS NULL
     OR _orig !~ ('^post-images/' || _owner::text || '/') THEN
    RAISE EXCEPTION 'MEDIA-2102 derivative original % is not inside post-images/%/', _orig, _owner
      USING ERRCODE = '23514';
  END IF;

  -- No traversal, no absolute paths, no host. The reader concatenates this
  -- onto the CDN origin verbatim.
  IF _orig LIKE '%..%' OR _orig LIKE '/%' OR _orig ~* '^https?://' THEN
    RAISE EXCEPTION 'MEDIA-2103 derivative original % must be a bucket-relative path', _orig
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.media_objects
     SET state = 'ready', derivatives = _derivatives
   WHERE id = _id AND state = 'verified';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'media % is not in state verified', _id USING ERRCODE = '23514';
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.media_mark_ready(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.media_mark_ready(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_mark_ready(uuid, jsonb) TO service_role;

-- ── 2. Atomic publish, now dual-writing the legacy arrays ──────────────────

CREATE OR REPLACE FUNCTION public.post_publish_with_media(
  _media_ids        uuid[],
  _content          text    DEFAULT '',
  _privacy          text    DEFAULT 'public',
  _categories       text[]  DEFAULT '{}',
  _indexing_disabled boolean DEFAULT false,
  _idempotency_key  text    DEFAULT NULL,
  _thumbnail_urls   text[]  DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid        uuid := auth.uid();
  _post_id    uuid;
  _n          int;
  _bad        int;
  _existing   uuid;
  _origin     text;
  _image_urls text[];
  _thumbs     text[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'publishing requires an authenticated caller' USING ERRCODE = '42501';
  END IF;

  IF _media_ids IS NULL OR array_length(_media_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'a post must carry at least one photograph' USING ERRCODE = '22023';
  END IF;

  _n := array_length(_media_ids, 1);
  IF _n > 10 THEN
    RAISE EXCEPTION 'a post carries at most 10 photographs (got %)', _n USING ERRCODE = '22023';
  END IF;

  -- Retry safety BEFORE any write: the same composition submitted twice
  -- returns the first post instead of creating a second.
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.posts
     WHERE user_id = _uid AND idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN _existing;
    END IF;
  END IF;

  -- No repeats: the same photograph twice in one carousel is a client bug,
  -- and post_media_post_media_uniq would refuse it mid-insert. Refuse here
  -- with a sentence instead.
  SELECT count(*) INTO _bad
  FROM (SELECT DISTINCT unnest(_media_ids) AS m) d;
  IF _bad <> _n THEN
    RAISE EXCEPTION 'the same photograph appears more than once in this post' USING ERRCODE = '22023';
  END IF;

  -- Ownership AND readiness, checked as a set so the error names the count
  -- rather than failing on whichever row happened to be first.
  SELECT count(*) INTO _bad
  FROM unnest(_media_ids) AS m(id)
  LEFT JOIN public.media_objects mo ON mo.id = m.id
  WHERE mo.id IS NULL OR mo.owner_id <> _uid OR mo.state <> 'ready';

  IF _bad > 0 THEN
    RAISE EXCEPTION
      '% of % photographs are not yours, do not exist, or are not finished uploading', _bad, _n
      USING ERRCODE = '42501';
  END IF;

  -- ── The delivery origin, read from settings rather than hardcoded ────────
  -- Fail loud. A published post carrying half a URL is worse than a refused
  -- publish, and guessing the host is how a whole day of media points at
  -- nothing.
  SELECT value->>'public_url' INTO _origin
  FROM public.site_settings WHERE key = 's3_storage_settings';

  IF _origin IS NULL OR _origin = '' THEN
    RAISE EXCEPTION 'MEDIA-2110 s3_storage_settings.public_url is not configured'
      USING ERRCODE = '22023';
  END IF;
  _origin := rtrim(_origin, '/');

  -- ── image_urls: DERIVED, never supplied ─────────────────────────────────
  -- Built in the caller's own ord order from the media rows themselves, so the
  -- legacy array and post_media cannot disagree about which photograph this is.
  SELECT array_agg(_origin || '/' || (mo.derivatives->>'original') ORDER BY t.ord)
    INTO _image_urls
  FROM unnest(_media_ids) WITH ORDINALITY AS t(mid, ord)
  JOIN public.media_objects mo ON mo.id = t.mid;

  IF _image_urls IS NULL OR array_length(_image_urls, 1) <> _n THEN
    RAISE EXCEPTION 'MEDIA-2111 could not derive % legacy urls', _n USING ERRCODE = '23514';
  END IF;

  -- ── thumbnail_urls: SUPPLIED but CONSTRAINED ────────────────────────────
  -- Exactly two honest values per slide: the full-size URL (the documented
  -- fallback when thumbnail encoding fails) or that URL with `-thumb` before
  -- the extension. Anything else would let a caller point a grid at an image
  -- the post does not contain.
  IF _thumbnail_urls IS NULL THEN
    _thumbs := _image_urls;
  ELSE
    IF array_length(_thumbnail_urls, 1) IS DISTINCT FROM _n THEN
      RAISE EXCEPTION 'MEDIA-2112 % thumbnails supplied for % photographs',
        coalesce(array_length(_thumbnail_urls, 1), 0), _n USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO _bad
    FROM generate_subscripts(_image_urls, 1) AS i
    WHERE _thumbnail_urls[i] IS DISTINCT FROM _image_urls[i]
      AND _thumbnail_urls[i] IS DISTINCT FROM
          regexp_replace(_image_urls[i], '\.([A-Za-z0-9]+)$', '-thumb.\1');

    IF _bad > 0 THEN
      RAISE EXCEPTION 'MEDIA-2113 % thumbnail url(s) are neither the photograph nor its -thumb sibling', _bad
        USING ERRCODE = '23514';
    END IF;
    _thumbs := _thumbnail_urls;
  END IF;

  INSERT INTO public.posts (user_id, content, privacy, categories, indexing_disabled,
                            idempotency_key, image_url, image_urls, thumbnail_urls)
  VALUES (_uid, COALESCE(_content, ''), _privacy, COALESCE(_categories, '{}'),
          COALESCE(_indexing_disabled, false), _idempotency_key,
          _image_urls[1], _image_urls, _thumbs)
  RETURNING id INTO _post_id;

  -- Contiguous ords 0..n-1 by construction: generated from the array's own
  -- ordinality, so a gap is not expressible.
  INSERT INTO public.post_media (post_id, ord, media_id)
  SELECT _post_id, ord - 1, mid
  FROM unnest(_media_ids) WITH ORDINALITY AS t(mid, ord);

  -- Completeness gate. Belt and braces: if any reference silently failed to
  -- land, this transaction dies and the post dies with it.
  SELECT count(*) INTO _bad FROM public.post_media WHERE post_id = _post_id;
  IF _bad <> _n THEN
    RAISE EXCEPTION 'publish aborted: % of % photographs attached', _bad, _n USING ERRCODE = '23514';
  END IF;

  RETURN _post_id;
END $function$;

-- The 6-argument shape is gone: leaving it beside the 7-argument one would
-- make every call with a NULL trailing argument ambiguous, and the old one
-- writes image_urls = '{}', which is precisely the blanking this migration
-- exists to prevent. Dropped rather than left as a trap.
DROP FUNCTION IF EXISTS public.post_publish_with_media(uuid[], text, text, text[], boolean, text);

REVOKE ALL ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) TO authenticated;

COMMENT ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) IS
  'One transaction: the post, all of its post_media references, and the legacy '
  'image_urls/thumbnail_urls arrays. image_urls is DERIVED from the media rows; '
  'thumbnail_urls is constrained to the photograph or its -thumb sibling. The '
  'dual-write is D-004 and is load-bearing for the Android binary.';

COMMIT;
