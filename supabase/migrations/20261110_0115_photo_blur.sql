-- ═══════════════════════════════════════════════════════════════════════════
-- Photo blur · 20261110_0115 — a tiny BLUR CODE per photo, shown at once.
-- Lanes: staging and production. Expand only: one new table, three functions.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (Owner, 6 Nov 2026: "blur is not showing in many photos, sometimes the
-- blur takes time … what can be done like FB does?" → "go blur", old AND new):
-- the blurred fill beside a photo was a second DOWNLOAD (the 600 copy, low
-- priority) blurred by the phone, and photos without a small copy had none.
-- Like Facebook / Instagram, each photo now gets a ~30-character ThumbHash
-- (https://evanw.github.io/thumbhash/, MIT) made ONCE by the server job
-- (tools/media-derivatives/blur.mjs). The card draws it with no download.
--
-- OBJECTS:
--   public.photo_blur (url PK, hash, tries, made_at) — RLS on, no policy, no
--     grant to anon / authenticated: read only through post_photo_blurs.
--   public.post_photo_blurs(uuid[]) → (post_id, url, hash)
--     · anon + authenticated, SECURITY DEFINER, search_path '';
--     · only posts the caller can view (can_view_post — the gate of 0109 / 0112),
--       only URLs the post shows now (image_urls, or the legacy image_url);
--     · at most 50 ids per call (PHOTO-BL-001).
--   public.photo_blur_todo(integer) → (url, thumb) — admin / converter only
--     (PHOTO-BL-002): photos posts show that have no code yet, newest post
--     first, skipping a URL that failed 3 times; `thumb` = the smallest stored
--     copy to read (0101's clean 600, else the post's thumbnail), NULL = read
--     the photo itself. At most 200.
--   public.photo_blur_record(jsonb) → integer — admin / converter only
--     (PHOTO-BL-002): [{url, hash}] stores a code; [{url}] (no hash) counts
--     one failed try. At most 200 rows (PHOTO-BL-003).
--
-- NOT RE-RUNNABLE: PRE-002 refuses once the table exists.
-- ROLLBACK: supabase/rollback/20261110_0115_photo_blur_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0115_photo_blur.sql (FAIL before, PASS after)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regclass('public.posts') IS NULL OR to_regclass('public.photo_set_backfill') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'BL-0115-PRE-001: posts, photo_set_backfill (0101), can_view_post(uuid,uuid,text), media_derivative_worker_ok or auth.uid is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.photo_blur') IS NOT NULL THEN
    RAISE EXCEPTION 'BL-0115-PRE-002: public.photo_blur already exists — 20261110_0115 is applied';
  END IF;
END
$pre$;

-- ── 1. the codes ───────────────────────────────────────────────────────────
CREATE TABLE public.photo_blur (
  url     text PRIMARY KEY CONSTRAINT photo_blur_url_check CHECK (url ~ '^https://' AND length(url) <= 2048),
  -- base64 of a ThumbHash (5–25 bytes). NULL = not made yet (only failed tries so far).
  hash    text CONSTRAINT photo_blur_hash_check CHECK (hash IS NULL OR hash ~ '^[A-Za-z0-9+/]{6,48}={0,2}$'),
  tries   smallint NOT NULL DEFAULT 0 CONSTRAINT photo_blur_tries_check CHECK (tries >= 0),
  made_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.photo_blur ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.photo_blur FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.photo_blur IS
  'Photo blur 0115: one ThumbHash per photo URL, made by the server job (tools/media-derivatives/blur.mjs). '
  'Read only through post_photo_blurs (can_view_post). No grant to anon / authenticated.';

-- ── 2. the card's read (anon + authenticated) ──────────────────────────────
CREATE FUNCTION public.post_photo_blurs(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, url text, hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-BL-001: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT DISTINCT p.id, b.url, b.hash
    FROM public.posts p
   CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[]) || coalesce(ARRAY[p.image_url], '{}'::text[])) AS u(src)
    JOIN public.photo_blur b ON b.url = u.src
   WHERE p.id = ANY (p_post_ids)
     -- ⚠ DO NOT REMOVE. This is the access control (as post_photo_feed_copies, 0112).
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     AND b.hash IS NOT NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.post_photo_blurs(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_blurs(uuid[]) TO anon, authenticated;
COMMENT ON FUNCTION public.post_photo_blurs(uuid[]) IS
  'Photo blur 0115: the ThumbHash of each photo a post shows now, for posts the caller can view (can_view_post). '
  'At most 50 ids (PHOTO-BL-001).';

-- ── 3. the job's two calls (admin or converter) ────────────────────────────
CREATE FUNCTION public.photo_blur_todo(_limit integer DEFAULT 100)
RETURNS TABLE(url text, thumb text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-BL-002 only an admin or the converter may read the blur list' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH shown AS (
    SELECT p.created_at, s.src,
           CASE WHEN cardinality(coalesce(p.thumbnail_urls, '{}'::text[])) = cardinality(coalesce(p.image_urls, '{}'::text[]))
                THEN p.thumbnail_urls[s.o] END AS t
      FROM public.posts p
     CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[])) WITH ORDINALITY AS s(src, o)
    UNION ALL
    SELECT p.created_at, p.image_url, NULL FROM public.posts p WHERE p.image_url IS NOT NULL
  ), todo AS (
    SELECT DISTINCT ON (sh.src) sh.src, sh.t, sh.created_at
      FROM shown sh
     WHERE sh.src ~ '^https://' AND length(sh.src) <= 2048
       AND sh.src !~* '\.(mp4|m3u8|mov|webm|m4v)(\?|#|$)'
       AND NOT EXISTS (SELECT 1 FROM public.photo_blur b WHERE b.url = sh.src AND (b.hash IS NOT NULL OR b.tries >= 3))
     ORDER BY sh.src, sh.t NULLS LAST, sh.created_at DESC
  )
  SELECT td.src,
         coalesce((SELECT bf.new_thumb FROM public.photo_set_backfill bf
                    WHERE bf.old_url = td.src AND bf.new_thumb ~ '^https://' LIMIT 1),
                  CASE WHEN td.t ~ '^https://' THEN td.t END)
    FROM todo td
   ORDER BY td.created_at DESC, td.src
   LIMIT least(greatest(coalesce(_limit, 100), 1), 200);
END;
$fn$;

CREATE FUNCTION public.photo_blur_record(_rows jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _n integer;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-BL-002 only an admin or the converter may record a blur code' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) > 200 THEN
    RAISE EXCEPTION 'PHOTO-BL-003 rows must be an array of at most 200' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.photo_blur AS b (url, hash, tries, made_at)
  SELECT DISTINCT ON (r->>'url') r->>'url', nullif(r->>'hash', ''), CASE WHEN nullif(r->>'hash', '') IS NULL THEN 1 ELSE 0 END, now()
    FROM jsonb_array_elements(_rows) AS r
   WHERE jsonb_typeof(r) = 'object' AND r->>'url' IS NOT NULL
  ON CONFLICT (url) DO UPDATE
     SET hash    = coalesce(EXCLUDED.hash, b.hash),
         tries   = CASE WHEN EXCLUDED.hash IS NULL THEN least(b.tries + 1, 100) ELSE b.tries END,
         made_at = now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.photo_blur_todo(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_blur_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_blur_todo(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_blur_record(jsonb) TO authenticated;
COMMENT ON FUNCTION public.photo_blur_todo(integer) IS
  'Photo blur 0115: photos posts show with no ThumbHash yet (newest first, a URL failed 3 times skipped). Admin / converter only (PHOTO-BL-002).';
COMMENT ON FUNCTION public.photo_blur_record(jsonb) IS
  'Photo blur 0115: store [{url, hash}] codes, or count a failed try for [{url}]. Admin / converter only (PHOTO-BL-002), ≤ 200 rows (PHOTO-BL-003).';

DO $post$
DECLARE _n bigint;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.post_photo_blurs(uuid[])'), to_regprocedure('public.photo_blur_todo(integer)'),
                   to_regprocedure('public.photo_blur_record(jsonb)'))
     AND p.prosecdef;
  IF _n <> 3 THEN RAISE EXCEPTION 'BL-0115-POST-001: % of 3 functions are SECURITY DEFINER', _n; END IF;
  IF has_table_privilege('anon', 'public.photo_blur', 'SELECT') OR has_table_privilege('authenticated', 'public.photo_blur', 'SELECT') THEN
    RAISE EXCEPTION 'BL-0115-POST-002: photo_blur is readable by anon or authenticated';
  END IF;
  SELECT count(DISTINCT s.src) INTO _n
    FROM public.posts p CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[])) AS s(src) WHERE s.src ~ '^https://';
  RAISE NOTICE 'BL-0115 applied on %: % photo URL(s) shown by posts, 0 codes yet — run photo-blur.yml', current_setting('p32.lane'), _n;
END
$post$;

COMMIT;
