-- ═══════════════════════════════════════════════════════════════════════════
-- THE CANDIDATE POPULATION IS WIDENED — IN A NEW FUNCTION, NEVER IN THE OLD ONE.
--
-- 34 slides across 19 posts are real photographs, in a bucket the CDN serves,
-- owned by the member who posted them, and outside every manifest only because
-- the engine's pattern did not describe them:
--
--   class B  post-images/<owner>/<file>                  19 slides / 12 posts
--   class C  avatars/<owner>/my-photos/<album>/<file>    15 slides /  7 posts
--
-- `docs/CANDIDATE_PATTERN_AUDIT.md` is the audit. This migration is its result.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠ WHY `media_migration_fence_digest` IS NOT TOUCHED
--
-- It digests the population AS OF A FENCE. Widening its regex changes what
-- every PAST fence covered. Measured 2026-08-20:
--
--     class B/C slides created at or before   cycle 1 fence   27
--                                             cycle 2 fence   34
--                                             cycle 3 fence   34
--                                             cycle 4 fence   34
--
-- So a widened v1 would make f0a74d3e…, 46c4cad2…, eff23edc… and c6173052…
-- all recompute to different values, and docs/MANIFEST_PROVENANCE.md — which
-- states that each still reproduces — would become false. The approved
-- manifests would no longer validate against the population they were approved
-- for.
--
-- v1 is therefore FROZEN FOR EVER. This adds a second function. The old digests
-- stay reproducible by construction rather than by anybody being careful.
--
-- ⚠ DO NOT "TIDY THIS UP" INTO ONE FUNCTION LATER. The duplication is the
-- safeguard. A single parameterised digest would let one careless default
-- silently redefine four frozen fences.
--
-- ───────────────────────────────────────────────────────────────────────────
-- MEDIA-2102 GENERALISES, AND ONLY IT
--
-- The property it guards is "the object is inside THIS ROW'S OWNER's folder",
-- not "the object is under post-images". Class C is inside the owner's folder,
-- in the other key prefix of the same bucket. So the check becomes
-- `^(post-images|avatars)/<owner>/`.
--
-- Not a weakening: the owner segment is still pinned to the row's owner, and
-- traversal, absolute paths and hosts are still refused by MEDIA-2103.
--
-- ⚠ THE LIVE WRITE PATH KEEPS THE NARROW RULE. `media-register-upload`'s
-- `objectKeyForOwner` still requires `post-images/<owner>/`, because there the
-- caller is a MEMBER, and an `avatars/…` path would be a member registering
-- their own mutable avatar as a post photograph. Narrow where the caller is a
-- member; general where the caller is the migration.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The widened population digest. A ∪ B ∪ C. ─────────────────────────────
-- ⚠ THE COLUMN NAMES ARE THE FROZEN FUNCTION'S, ON PURPOSE. This must be a
-- DROP-IN so `migrate-post-media` reads `key_set_md5`/`item_count` identically
-- whichever population a run was gated on, and so a reader comparing the two is
-- not tripped by a cosmetic difference.
CREATE OR REPLACE FUNCTION public.media_migration_fence_digest_wide(_fence timestamptz)
RETURNS TABLE (key_set_md5 text, item_count integer, post_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with cand as (
    select p.id::text as post_id, u.ord::int as ord, u.url
    from public.posts p
    cross join lateral unnest(p.image_urls) with ordinality as u(url, ord)
    where p.image_urls is not null
      and p.privacy = 'public'
      and p.created_at <= _fence
      and (
        -- class A, byte-for-byte the frozen pattern
        u.url ~ '^https://cdn\.50mmretina\.com/post-images/[0-9a-f-]{36}/posts/[^/?]+$'
        -- class B — older flat naming, same bucket, owner still at segment 2
        or u.url ~ '^https://cdn\.50mmretina\.com/post-images/[0-9a-f-]{36}/[^/?]+$'
        -- class C — album uploads that landed under the avatars prefix
        or u.url ~ '^https://cdn\.50mmretina\.com/avatars/[0-9a-f-]{36}/my-photos/[0-9a-f-]{36}/[^/?]+$'
      )
  )
  select md5(string_agg(post_id||'|'||ord||'|'||url, E'\n' order by post_id||'|'||ord||'|'||url)),
         count(*)::int,
         count(distinct post_id)::int
  from cand;
$function$;

REVOKE ALL ON FUNCTION public.media_migration_fence_digest_wide(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.media_migration_fence_digest_wide(timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_migration_fence_digest_wide(timestamptz) TO service_role;

COMMENT ON FUNCTION public.media_migration_fence_digest_wide(timestamptz) IS
  'The candidate population including classes B and C, as of a fence. The '
  'ORIGINAL media_migration_fence_digest is frozen and must never be widened: '
  '27-34 class B/C slides predate every historical fence, so widening it would '
  'retroactively change four approved digests. service_role only.';

-- ── MEDIA-2102 generalises to the owner's folder in either prefix ──────────
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

  -- ⚠ DO NOT REMOVE, AND DO NOT WIDEN THE PREFIX LIST. The object a row is
  -- marked ready against must live inside that row's OWNER's folder. The two
  -- prefixes are the two key prefixes of the one R2 bucket that hold member
  -- media; adding a third would let a writer point a member's row at platform
  -- assets. The owner segment is the part that must never move.
  IF _orig IS NULL
     OR _orig !~ ('^(post-images|avatars)/' || _owner::text || '/') THEN
    RAISE EXCEPTION 'MEDIA-2102 derivative original % is not inside <post-images|avatars>/%/', _orig, _owner
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
