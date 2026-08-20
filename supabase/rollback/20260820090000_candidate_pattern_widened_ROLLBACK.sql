-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260820090000_candidate_pattern_widened.
--
-- ⚠ THE FROZEN FUNCTION WAS NEVER TOUCHED, SO THERE IS NOTHING TO RESTORE
-- THERE. `media_migration_fence_digest` is byte-identical to its definition in
-- 20260818011014 and all four historical digests reproduce. That is the whole
-- design: the widening was additive precisely so that reverting it cannot
-- disturb the provenance chain.
--
-- This drops the wide function and narrows MEDIA-2102 back to `post-images/`.
--
-- ⚠ IF ANY CLASS-C MEDIA HAS ALREADY BEEN MIGRATED, DO NOT RUN THIS WITHOUT
-- READING THIS PARAGRAPH. Narrowing MEDIA-2102 does not invalidate rows that
-- are already `ready` — the check runs only on the transition — so migrated
-- class-C posts keep working. What it does prevent is any FUTURE repair of
-- those rows, because a re-mark would then be refused. Check first:
--
--     select count(*) from media_objects where derivatives->>'original' like 'avatars/%';
--
-- If that is non-zero, narrowing is a decision about future repairability, not
-- a neutral revert. Say so out loud before running it.
--
-- ⚠ DO NOT ALSO DELETE MIGRATED CLASS-B/C ROWS. They carry verified content
-- hashes taken from the real bytes. Deleting them to "undo" the widening
-- destroys provenance that a re-migration would have to re-earn by
-- re-downloading every object.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.media_migration_fence_digest_wide(timestamptz);

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

  IF _orig IS NULL
     OR _orig !~ ('^post-images/' || _owner::text || '/') THEN
    RAISE EXCEPTION 'MEDIA-2102 derivative original % is not inside post-images/%/', _orig, _owner
      USING ERRCODE = '23514';
  END IF;

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

COMMIT;
