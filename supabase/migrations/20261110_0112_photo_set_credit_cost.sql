-- ════════════════════════════════════════════════════════════════════════════
-- Credit U3 · 20261110_0112 — ONE PHOTO, ONE LOOK-UP, NOT ONE TABLE SCAN.
-- Lanes: staging and production. Applies once (PRE-002).
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE CAUSE. photo_set_credit_named() unpacks every URL of every post and every
-- competition entry. 0111 calls it from the queue (right: one call per 100
-- photos) AND from photo_set_credit_target and photo_set_credit_record, once per
-- photo, only to ask "does a row name THIS key?". The worker calls target twice
-- and record once for each photo it draws, so a sweep costs 3 scans of both
-- tables per photo, and the cost grows with photos × rows.
--
-- THE FIX. Those two questions become one exact look-up:
--   idx_posts_image_urls_gin, idx_competition_entries_photos_gin
--                                  what `@>` needs; none existed
--   photo_set_credit_is_named(key) internal: the same answer as named(), by index
--   photo_set_credit_target / _record   ask that instead of scanning
-- The queue keeps photo_set_credit_named(): it has to list the missing work, so
-- it is one read of each table per claim of 100, not per photo.
--
-- WHY GIN AND NOT posts.user_id. The key's folder holds a uuid, but nothing in
-- the schema promises it equals the row's user_id. A look-up by user would turn
-- "some row names this" into "its owner's row names this", and a photo the queue
-- lists could then never be drawn. `@>` asks exactly what named() asked.
--
-- WHY fastupdate = off. The sweep looks up rows written minutes earlier. With
-- fastupdate they sit in the unsorted pending list, up to 4 MB read per look-up.
-- Writes change only when image_urls / photos change, and posts is small.
--
-- WHY enable_seqscan off ON THE HELPER. On a small table the planner may prefer a
-- sequential read, and EXISTS makes it hopeful of stopping early; a key no row
-- names reads the whole table. This is one exact key, so the index is always
-- right. It holds for this function only, and without the index it still answers.
--
-- LOCKS. CREATE INDEX takes SHARE on each table (writes wait, reads do not) for
-- the build, then the commit. Production held 661 post photos on 4 Nov 2026.
-- lock_timeout 5 s: a queued lock aborts the whole file and nothing changes.
-- Nothing here changes a row, a queue, a switch or a screen.
--
-- ROLLBACK: supabase/rollback/20261110_0112_photo_set_credit_cost_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0112_photo_set_credit_cost.sql (FAIL before the apply)
-- FIXTURE:  scripts/db-photo-credit-cost-fixture.mjs (the same files, measured at two sizes)
-- ════════════════════════════════════════════════════════════════════════════

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
  IF to_regprocedure('public.photo_set_credit_named()') IS NULL
     OR to_regprocedure('public.photo_set_credit_target(text)') IS NULL
     OR to_regprocedure('public.photo_set_credit_record(text,integer,boolean,text)') IS NULL
     OR to_regprocedure('public.photo_set_backfill_cdn()') IS NULL THEN
    RAISE EXCEPTION 'SC-0112-PRE-001: 20261110_0111 is not applied on this lane';
  END IF;
  IF (SELECT a.atttypid FROM pg_attribute a WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'image_urls') IS DISTINCT FROM 'text[]'::regtype
     OR (SELECT a.atttypid FROM pg_attribute a WHERE a.attrelid = 'public.competition_entries'::regclass AND a.attname = 'photos') IS DISTINCT FROM 'text[]'::regtype THEN
    RAISE EXCEPTION 'SC-0112-PRE-001: posts.image_urls or competition_entries.photos is not text[]';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regprocedure('public.photo_set_credit_is_named(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-0112-PRE-002: photo_set_credit_is_named already exists — 20261110_0112 is applied';
  END IF;
END
$pre$;

-- ── 1. the indexes ──────────────────────────────────────────────────────────
-- P28: posts · hundreds of rows on 4 Nov 2026 · one exact photo look-up per sweep call, instead of a full read per call
CREATE INDEX idx_posts_image_urls_gin ON public.posts USING gin (image_urls) WITH (fastupdate = off);
-- P28: competition_entries · hundreds of rows · the same look-up for an entry's photos; every call asks both tables
CREATE INDEX idx_competition_entries_photos_gin ON public.competition_entries USING gin (photos) WITH (fastupdate = off);

-- ── 2. the one look-up ──────────────────────────────────────────────────────
-- The same answer as `EXISTS (SELECT 1 FROM photo_set_credit_named() n WHERE
-- n.photo_key = _key)`: the key's shape, then the exact URL the key stands for.
-- NULL is false, so record's `IF NOT` still refuses it.
CREATE FUNCTION public.photo_set_credit_is_named(_key text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO '' SET enable_seqscan TO off AS $fn$
  SELECT coalesce(_key ~ '^(post-images/[0-9a-f-]{36}/posts|competition-photos/[0-9a-f-]{36}/competitions)/[A-Za-z0-9_.-]+-w[0-9]{1,5}h[0-9]{1,5}-l5f?\.webp$', false)
     AND (EXISTS (SELECT 1 FROM public.posts p
                   WHERE p.image_urls @> ARRAY['https://' || public.photo_set_backfill_cdn() || '/' || _key])
          OR EXISTS (SELECT 1 FROM public.competition_entries e
                      WHERE e.photos @> ARRAY['https://' || public.photo_set_backfill_cdn() || '/' || _key]))
$fn$;
REVOKE ALL ON FUNCTION public.photo_set_credit_is_named(text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.photo_set_credit_is_named(text) IS
  'Credit U3: does a post or an entry name this v3 photo? One index look-up per table. Internal.';

-- ── 3. the two per-photo calls ask it ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.photo_set_credit_target(_key text)
RETURNS TABLE(done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may write credited copies' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT EXISTS (SELECT 1 FROM public.photo_set_credit c WHERE c.photo_key = _key)
   WHERE public.photo_set_credit_is_named(_key);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.photo_set_credit_record(_key text, _version integer, _drawn boolean, _origin text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may record credited copies' USING ERRCODE = '42501';
  END IF;
  IF NOT public.photo_set_credit_is_named(_key) THEN
    RAISE EXCEPTION 'PHOTO-SC-002 no post or entry names this photo' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.photo_set_credit (photo_key, credit_version, drawn, origin, recorded_by)
  VALUES (_key, _version, _drawn, _origin, auth.uid())
  ON CONFLICT (photo_key) DO UPDATE
     SET credit_version = EXCLUDED.credit_version, drawn = EXCLUDED.drawn, origin = EXCLUDED.origin,
         recorded_by = EXCLUDED.recorded_by, recorded_at = now()
   WHERE public.photo_set_credit.credit_version < EXCLUDED.credit_version;
  DELETE FROM public.photo_credit_failure f WHERE f.subject = _key;
END;
$fn$;

-- The same callers as 0111: the worker's account, never anon.
REVOKE ALL ON FUNCTION public.photo_set_credit_target(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_set_credit_record(text, integer, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_set_credit_target(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_set_credit_record(text, integer, boolean, text) TO authenticated;

DO $post$
BEGIN
  IF has_function_privilege('anon', 'public.photo_set_credit_is_named(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_set_credit_is_named(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SC-0112-POST-001: photo_set_credit_is_named is executable by anon or authenticated';
  END IF;
  RAISE NOTICE 'SC-0112 applied on %', current_setting('p32.lane');
END
$post$;

COMMIT;
