-- ═══════════════════════════════════════════════════════════════════════════
-- B5-1 — ATOMIC PUBLISH. Closes checklist item 11 (post publish atomicity)
-- and the R15 gap the B4 matrix left open.
--
-- WHY NOT A `status` COLUMN (the original Phase-0 sketch):
--   That sketch assumed posts holds unpublished rows moving pending_media →
--   published. It does not. Drafts live in `post_drafts` and scheduled posts
--   in `scheduled_posts`; `posts` has only ever meant "published". Adding a
--   status column would put a filter obligation on 13 server functions and
--   every client query, to represent a state that no row would ever be in.
--   The blast radius would be large and the benefit zero.
--
--   The property the sketch was reaching for — "no post exists that is
--   missing some of its photos" — is better obtained by never creating the
--   incomplete state in the first place. One transaction inserts the post AND
--   all of its media references, verifies completeness, and only then
--   commits. A crash, a dropped connection, or a refused reference rolls the
--   whole thing back: no post, no partial references, nothing to clean up.
--
-- WHAT IT ENFORCES
--   • every media_id is owned by the caller            (no attaching someone
--                                                       else's photograph)
--   • every media_id is state='ready'                  (the existing trigger
--                                                       also refuses, but a
--                                                       clear error beats a
--                                                       constraint name)
--   • ords are 0..n-1 with no gaps and no repeats      (R15 / R16)
--   • a retry with the same idempotency_key returns the SAME post rather
--     than creating a second one                       (item 9/10)
--
-- INERT UNTIL THE CLIENT SWITCH: nothing calls this yet, and `post_media`
-- holds zero production rows. It ships now so the switch inherits a proven
-- write path instead of being where the write path is first exercised.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial unique: only rows that actually carry a key participate, so the
-- 210 existing posts (and every legacy insert) are untouched.
CREATE UNIQUE INDEX IF NOT EXISTS posts_user_idempotency_key
  ON public.posts (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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

  INSERT INTO public.posts (user_id, content, privacy, categories, indexing_disabled, idempotency_key, image_urls)
  VALUES (_uid, COALESCE(_content, ''), _privacy, COALESCE(_categories, '{}'), COALESCE(_indexing_disabled, false), _idempotency_key, '{}')
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

REVOKE ALL ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text) TO authenticated;
