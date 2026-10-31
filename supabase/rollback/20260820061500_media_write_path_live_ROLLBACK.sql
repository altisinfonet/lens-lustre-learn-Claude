-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260820061500_media_write_path_live.
--
-- ⚠ READ THIS BEFORE RUNNING IT.
--
-- This restores the PRE-Phase-2-write-path shapes: `media_mark_ready` without
-- the owner-folder check, and the 6-argument `post_publish_with_media` that
-- writes `image_urls = '{}'`.
--
-- Running it while the deployed client calls the 7-argument form means every
-- publish attempt fails the RPC and falls back to the legacy insert. That is
-- SAFE for members — the fallback exists precisely for this — and it is the
-- intended behaviour of a rollback: new posts go back to being
-- `image_urls`-only, MEDIA-4001 fires on every one of them, and the delta
-- starts growing again until the migration is re-applied.
--
-- ⚠ POSTS ALREADY PUBLISHED THROUGH THE NEW PATH ARE NOT AFFECTED and MUST NOT
-- BE "CLEANED UP". They carry correct `post_media` rows AND correct
-- `image_urls`, so they read identically on both paths. Deleting their media
-- rows to "undo" the migration would destroy verified provenance for no gain.
--
-- This does NOT undeploy `media-register-upload`. Leaving it deployed is
-- harmless: with the old `post_publish_with_media` in place, media rows that
-- reach `ready` are simply never referenced by a post, and the orphan sweep
-- reports them (it is media-aware since Item D). Undeploy it separately and
-- deliberately if that is really what is wanted.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── media_mark_ready, as it was before MEDIA-2101/2102/2103 ───────────────
CREATE OR REPLACE FUNCTION public.media_mark_ready(_id uuid, _derivatives jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _bad text;
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

-- ── post_publish_with_media, 6-argument form, image_urls = '{}' ───────────
DROP FUNCTION IF EXISTS public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]);

CREATE OR REPLACE FUNCTION public.post_publish_with_media(
  _media_ids        uuid[],
  _content          text    DEFAULT '',
  _privacy          text    DEFAULT 'public',
  _categories       text[]  DEFAULT '{}',
  _indexing_disabled boolean DEFAULT false,
  _idempotency_key  text    DEFAULT NULL
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

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.posts
     WHERE user_id = _uid AND idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN _existing;
    END IF;
  END IF;

  SELECT count(*) INTO _bad
  FROM (SELECT DISTINCT unnest(_media_ids) AS m) d;
  IF _bad <> _n THEN
    RAISE EXCEPTION 'the same photograph appears more than once in this post' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO _bad
  FROM unnest(_media_ids) AS m(id)
  LEFT JOIN public.media_objects mo ON mo.id = m.id
  WHERE mo.id IS NULL OR mo.owner_id <> _uid OR mo.state <> 'ready';

  IF _bad > 0 THEN
    RAISE EXCEPTION
      '% of % photographs are not yours, do not exist, or are not finished uploading', _bad, _n
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.posts (user_id, content, privacy, categories, indexing_disabled, idempotency_key, image_urls)
  VALUES (_uid, COALESCE(_content, ''), _privacy, COALESCE(_categories, '{}'), COALESCE(_indexing_disabled, false), _idempotency_key, '{}')
  RETURNING id INTO _post_id;

  INSERT INTO public.post_media (post_id, ord, media_id)
  SELECT _post_id, ord - 1, mid
  FROM unnest(_media_ids) WITH ORDINALITY AS t(mid, ord);

  SELECT count(*) INTO _bad FROM public.post_media WHERE post_id = _post_id;
  IF _bad <> _n THEN
    RAISE EXCEPTION 'publish aborted: % of % photographs attached', _bad, _n USING ERRCODE = '23514';
  END IF;

  RETURN _post_id;
END $function$;

REVOKE ALL ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text) TO authenticated;

COMMIT;
