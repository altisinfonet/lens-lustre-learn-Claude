-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan U5 · 20261110_0101 — the photo-set BACKFILL (database half).
-- Lanes: staging and production. Changes NOTHING a member sees.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE: every old post photo in the lane's photo bucket can be given the v2
-- set (credited 2048 / 1080 / 600 / 320, `-l4` names) BESIDE it, by an admin or
-- the converter account only; a photo is recorded only with its whole set in
-- the store; the census and the (separate, audited) URL swap read that record.
--
-- HOW (design: docs/evidence/photo-plan/U5/README.md):
--   tools/media-derivatives/photo-set.mjs  (worker, run by s3-media-backfill.yml job=photo-set)
--     → functions/api/media/photoset/{claim,source,put,done}.ts  (Pages, PHOTOS binding)
--       → the three worker functions below, called AS the worker's JWT.
--   The Pages routes derive every key from the source key this SQL names and
--   never overwrite; `done` HEADs every copy before `photo_set_backfill_record`.
--   posts.image_urls is NOT touched here — the swap is 20261110_0102.
--
-- SCOPE (one rule, photo_set_backfill_source_key): a posts.image_urls entry
--   https://<this lane's CDN host>/post-images/<owner uuid>/[…/]<name>.webp[?…]
--   that is not already a v2 set, not a derivative folder (/d/), not a copy
--   (-thumb, -l3-rNNNN). Everything else stays as it is and the census reports
--   it by class (avatars / My Photos files, Supabase-storage URLs, other hosts).
--   The lane's CDN host is fixed at apply time from p32.lane:
--     production cdn.50mmretina.com · staging cdn-staging.50mmretina.com
--
-- OBJECTS (expand only — nothing existing is changed):
--   · public.photo_set_backfill (post_id, ord, old_url, new_url, new_thumb, recorded_by, recorded_at)
--       PK (post_id, ord). One row = "this photo's v2 set is complete in the store".
--       A row whose old_url no longer equals posts.image_urls[ord+1] is stale and
--       is ignored (and replaced by the next record). ON DELETE CASCADE from posts.
--   · public.photo_set_swap (post_id PK, old_* and new_* of image_urls,
--       thumbnail_urls, image_url, thumbnail_url, swapped_at) — written ONLY by
--       20261110_0102 (the swap); its ROLLBACK restores old_* from here exactly.
--   · RLS ON for both, no policies, nothing granted to anon / authenticated.
--   · public.photo_set_backfill_cdn()                 the lane's CDN host (constant)
--   · public.photo_set_backfill_source_key(text)      URL → bucket key, or NULL (out of scope)
--   · public.photo_set_backfill_new_url(text, text)   source key + 2048 key → the new URL,
--                                                     refusing any key that is not
--                                                     `<source minus .webp>-w{W}h{H}-l4.webp`
--                                                     with 1 ≤ W, H ≤ 2048 (PHOTO-BF-002)
--     (these three: internal, EXECUTE revoked from PUBLIC, anon, authenticated)
--   · public.photo_set_backfill_queue(int, uuid)      the missing work, ≤ 50 POSTS per call
--                                                     (all their pending photos), post-id cursor
--   · public.photo_set_backfill_target(uuid, int)     one photo's source key + done flag
--   · public.photo_set_backfill_record(uuid, int, text) records one complete set
--     (these three: SECURITY DEFINER search_path="", authenticated only, and the
--      body refuses everybody but media_derivative_worker_ok() — PHOTO-BF-001)
--
-- ERROR CODES (the message starts with the code):
--   PHOTO-BF-001 not an admin or the converter account      (42501)
--   PHOTO-BF-002 the 2048 key is not this photo's v2 name   (22023)
--   PHOTO-BF-404 the photo is not backfill work             (P0002)
--
-- NOT RE-RUNNABLE: PRE-002 refuses once photo_set_backfill exists.
-- ROLLBACK: supabase/rollback/20261110_0101_photo_set_backfill_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0101_photo_set_backfill.sql (FAIL before, PASS after)
-- CENSUS:   supabase/migrations/PROBE_20261110_0101_photo_set_census.sql   (PASS = every in-scope photo has its set)
-- FIXTURE:  .github/workflows/d1-photo-set-backfill-fixture.yml (both lane shapes)
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
  IF to_regclass('public.posts') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'custom_url')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'thumbnail_urls') THEN
    RAISE EXCEPTION 'U5-0101-PRE-001: posts(thumbnail_urls), profiles(custom_url), has_role, media_derivative_worker_ok or auth.uid is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.photo_set_backfill') IS NOT NULL OR to_regclass('public.photo_set_swap') IS NOT NULL
     OR to_regprocedure('public.photo_set_backfill_queue(integer,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'U5-0101-PRE-002: photo-set backfill objects already exist — 20261110_0101 is applied';
  END IF;
END
$pre$;

-- ── 1. tables ───────────────────────────────────────────────────────────────
CREATE TABLE public.photo_set_backfill (
  post_id     uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  ord         integer     NOT NULL CHECK (ord BETWEEN 0 AND 49),
  old_url     text        NOT NULL,
  new_url     text        NOT NULL CHECK (new_url ~ '-w[0-9]{1,4}h[0-9]{1,4}-l4\.webp$'),
  new_thumb   text        NOT NULL CHECK (new_thumb ~ '-w[0-9]{1,4}h[0-9]{1,4}-l4-thumb\.webp$'),
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, ord)
);

CREATE TABLE public.photo_set_swap (
  post_id            uuid        PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  old_image_urls     text[]      NOT NULL,
  old_thumbnail_urls text[],
  old_image_url      text,
  old_thumbnail_url  text,
  new_image_urls     text[]      NOT NULL,
  new_thumbnail_urls text[],
  new_image_url      text,
  new_thumbnail_url  text,
  photos_swapped     integer     NOT NULL CHECK (photos_swapped > 0),
  swapped_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.photo_set_backfill ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_set_swap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_set_backfill, public.photo_set_swap FROM PUBLIC, anon, authenticated;

-- ── 2. internal helpers ─────────────────────────────────────────────────────
DO $cdn$
DECLARE _host text := CASE current_setting('p32.lane') WHEN 'production' THEN 'cdn.50mmretina.com' ELSE 'cdn-staging.50mmretina.com' END;
BEGIN
  EXECUTE format($f$
    CREATE FUNCTION public.photo_set_backfill_cdn()
    RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $b$ SELECT %L::text $b$
  $f$, _host);
END
$cdn$;
COMMENT ON FUNCTION public.photo_set_backfill_cdn() IS
  'Photo plan U5: this lane''s photo CDN host, fixed at apply time from p32.lane.';

CREATE FUNCTION public.photo_set_backfill_source_key(_url text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO '' AS $fn$
DECLARE _m text[]; _k text;
BEGIN
  IF _url IS NULL THEN RETURN NULL; END IF;
  _m := regexp_match(_url,
    '^https://' || replace(public.photo_set_backfill_cdn(), '.', '\.')
    || '/(post-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.webp)(?:\?[^#]*)?$');
  _k := _m[1];
  IF _k IS NULL
     OR position('..' IN _k) > 0
     OR split_part(_k, '/', 3) = 'd'
     OR _k ~* '-l4f?(-thumb|-r[0-9]{3,4})?\.webp$'
     OR _k ~* '-thumb\.webp$'
     OR _k ~* '-l3-r[0-9]{3,4}\.webp$' THEN
    RETURN NULL;
  END IF;
  RETURN _k;
END;
$fn$;

CREATE FUNCTION public.photo_set_backfill_new_url(_source_key text, _master_key text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO '' AS $fn$
DECLARE _stem text; _m text[];
BEGIN
  IF _source_key IS NULL OR _source_key !~ '\.webp$' OR _master_key IS NULL THEN
    RAISE EXCEPTION 'PHOTO-BF-002 the 2048 key is not this photo''s v2 name' USING ERRCODE = '22023';
  END IF;
  _stem := left(_source_key, -5);
  IF left(_master_key, length(_stem)) <> _stem THEN
    RAISE EXCEPTION 'PHOTO-BF-002 the 2048 key is not this photo''s v2 name' USING ERRCODE = '22023';
  END IF;
  _m := regexp_match(substr(_master_key, length(_stem) + 1), '^-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp$');
  IF _m IS NULL OR _m[1]::int NOT BETWEEN 1 AND 2048 OR _m[2]::int NOT BETWEEN 1 AND 2048 THEN
    RAISE EXCEPTION 'PHOTO-BF-002 the 2048 key is not this photo''s v2 name' USING ERRCODE = '22023';
  END IF;
  RETURN 'https://' || public.photo_set_backfill_cdn() || '/' || _master_key;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_set_backfill_cdn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.photo_set_backfill_source_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.photo_set_backfill_new_url(text, text) FROM PUBLIC, anon, authenticated;

-- ── 3. the worker's three functions ─────────────────────────────────────────
CREATE FUNCTION public.photo_set_backfill_queue(_limit integer DEFAULT 10, _after uuid DEFAULT NULL)
RETURNS TABLE(post_id uuid, ord integer, source_key text, owner_full_name text, owner_handle text, owner_is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-BF-001 only an admin or the converter may read the photo-set queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH photos AS (
    SELECT p.id AS pid, (u.i - 1)::integer AS o, u.url, public.photo_set_backfill_source_key(u.url) AS k
      FROM public.posts p
     CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY AS u(url, i)
     WHERE (_after IS NULL OR p.id > _after) AND u.i <= 50
  ), todo AS (
    SELECT ph.pid, ph.o, ph.k FROM photos ph
     WHERE ph.k IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.photo_set_backfill b
                        WHERE b.post_id = ph.pid AND b.ord = ph.o AND b.old_url = ph.url)
  ), pick AS (
    SELECT DISTINCT t.pid FROM todo t ORDER BY t.pid LIMIT least(greatest(coalesce(_limit, 10), 1), 50)
  )
  SELECT t.pid, t.o, t.k, pr.full_name, pr.custom_url,
         public.has_role(split_part(t.k, '/', 2)::uuid, 'admin'::public.app_role)
    FROM todo t
    JOIN pick USING (pid)
    LEFT JOIN public.profiles pr ON pr.id = split_part(t.k, '/', 2)::uuid
   ORDER BY t.pid, t.o;
END;
$fn$;

CREATE FUNCTION public.photo_set_backfill_target(_post_id uuid, _ord integer)
RETURNS TABLE(source_key text, done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _url text; _k text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-BF-001 only an admin or the converter may write photo-set copies' USING ERRCODE = '42501';
  END IF;
  IF _ord IS NULL OR _ord NOT BETWEEN 0 AND 49 THEN RETURN; END IF;
  SELECT p.image_urls[_ord + 1] INTO _url FROM public.posts p WHERE p.id = _post_id;
  _k := public.photo_set_backfill_source_key(_url);
  IF _k IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT _k, EXISTS (SELECT 1 FROM public.photo_set_backfill b
                                   WHERE b.post_id = _post_id AND b.ord = _ord AND b.old_url = _url);
END;
$fn$;

CREATE FUNCTION public.photo_set_backfill_record(_post_id uuid, _ord integer, _master_key text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _url text; _k text; _new text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-BF-001 only an admin or the converter may record photo-set copies' USING ERRCODE = '42501';
  END IF;
  IF _ord IS NULL OR _ord NOT BETWEEN 0 AND 49 THEN
    RAISE EXCEPTION 'PHOTO-BF-404 not backfill work' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.image_urls[_ord + 1] INTO _url FROM public.posts p WHERE p.id = _post_id;
  _k := public.photo_set_backfill_source_key(_url);
  IF _k IS NULL THEN
    RAISE EXCEPTION 'PHOTO-BF-404 not backfill work' USING ERRCODE = 'P0002';
  END IF;
  _new := public.photo_set_backfill_new_url(_k, _master_key);
  INSERT INTO public.photo_set_backfill AS b (post_id, ord, old_url, new_url, new_thumb, recorded_by)
  VALUES (_post_id, _ord, _url, _new, regexp_replace(_new, '-l4\.webp$', '-l4-thumb.webp'), (SELECT auth.uid()))
  ON CONFLICT (post_id, ord) DO UPDATE
    SET old_url = EXCLUDED.old_url, new_url = EXCLUDED.new_url, new_thumb = EXCLUDED.new_thumb,
        recorded_by = EXCLUDED.recorded_by, recorded_at = now()
    WHERE b.old_url IS DISTINCT FROM EXCLUDED.old_url OR b.new_url IS DISTINCT FROM EXCLUDED.new_url;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_set_backfill_queue(integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_set_backfill_target(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_set_backfill_record(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_set_backfill_queue(integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_set_backfill_target(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_set_backfill_record(uuid, integer, text) TO authenticated;

DO $done$
BEGIN
  RAISE NOTICE 'U5-0101 applied on % (CDN host %): photo-set backfill objects created; no post changed.',
    current_setting('p32.lane'), public.photo_set_backfill_cdn();
END
$done$;

COMMIT;
