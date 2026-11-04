-- ════════════════════════════════════════════════════════════════════════════
-- Credit U3 · 20261110_0111 — THE SERVER DRAWS A NEW PHOTO'S CREDIT.
-- Lanes: staging and production. Applies once (PRE-002).
-- ════════════════════════════════════════════════════════════════════════════
--
-- Owner (4 Nov 2026): one renderer, geometry v5. The uploader no longer draws
-- a credit in the browser; it sends clean files. Once a post or a competition
-- entry names a v3 photo (`-l5` / `-l5f`), the worker draws `<photo>-r2048c.webp`
-- from the private clean 2048 with tools/media-derivatives/credit-render.mjs,
-- and this file records which credit that file carries.
--
-- THE QUEUE IS THE MISSING WORK: every v3 photo a row names with no record. A
-- credited file already in the store (an older client's canvas, a rectified
-- photo) is never drawn over; the route records it as version 4, origin
-- 'existing', so the later v5 redraw can find it. Nothing here touches a post.
--
--   photo_set_credit                     one row per v3 photo: credit_version, drawn, origin
--   photo_set_credit_named()             internal: the v3 photos posts and entries name (+ owner)
--   photo_set_credit_queue(limit, after) worker: photos with no record (+ owner name for the line)
--   photo_set_credit_target(key)         worker: one row when something names the key, with done
--   photo_set_credit_record(key, version, drawn, origin)  worker: record it
--   photo_credit_failure                 one row per photo that keeps failing (new or old)
--   photo_credit_parked(subject)         internal: 5 failures, and tried within the last day
--   photo_credit_failed(subject, error)  worker: count a failure, answer the attempts
--   photo_credit_parked_count()          worker: how many are parked, for the run's report
--   photo_old_credit_queue(limit, after) 0109's queue, leaving parked photos out
--   photo_old_credit_record(post, ord, key, version)      worker: 0109's record, with the version
--                                        the file really carries (the 3-argument one wrote 4;
--                                        it stays for the deployed route until this code is live)
--   photo_l4_rectify.credit_version      default 5: a rectified photo is drawn by the one renderer
--   (worker functions: SECURITY DEFINER search_path "", authenticated only, the
--    body refuses everybody but media_derivative_worker_ok() — PHOTO-SC-001)
--
-- ROLLBACK: supabase/rollback/20261110_0111_photo_set_credit_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261110_0111_photo_set_credit.sql (FAIL before the apply)
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
  IF to_regclass('public.posts') IS NULL OR to_regclass('public.competition_entries') IS NULL
     OR to_regclass('public.profiles') IS NULL OR to_regclass('public.photo_l4_rectify') IS NULL
     OR to_regclass('public.photo_old_credit') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('public.photo_set_backfill_cdn()') IS NULL
     OR to_regprocedure('public.photo_old_credit_class(text)') IS NULL
     OR to_regprocedure('public.photo_old_credit_key(uuid,uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'SC-0111-PRE-001: posts, competition_entries, profiles, has_role, media_derivative_worker_ok or 0101/0106/0109 is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.photo_set_credit') IS NOT NULL THEN
    RAISE EXCEPTION 'SC-0111-PRE-002: photo_set_credit already exists — 20261110_0111 is applied';
  END IF;
END
$pre$;

-- ── 1. the table ────────────────────────────────────────────────────────────
CREATE TABLE public.photo_set_credit (
  photo_key      text        PRIMARY KEY
                 CHECK (photo_key ~ '^(post-images/[0-9a-f-]{36}/posts|competition-photos/[0-9a-f-]{36}/competitions)/[A-Za-z0-9_.-]+-w[0-9]{1,5}h[0-9]{1,5}-l5f?\.webp$'),
  credit_version integer     NOT NULL CHECK (credit_version BETWEEN 1 AND 99),
  drawn          boolean     NOT NULL,
  origin         text        NOT NULL CHECK (origin IN ('server', 'existing')),
  recorded_by    uuid,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.photo_set_credit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_set_credit FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.photo_set_credit IS
  'Credit U3: which credit the -r2048c copy of a v3 photo carries. Written only by '
  'photo_set_credit_record(). drawn = false: the photo is too small for the line, the copy is clean.';

-- A photo that cannot be drawn must not be retried every 15 minutes for ever:
-- after 5 failures the queues leave it out, except for one try a day (so a
-- passing outage heals by itself). A success removes the row.
CREATE TABLE public.photo_credit_failure (
  subject    text        PRIMARY KEY
             CHECK (subject ~ '^(post-images/[0-9a-f-]{36}/posts|competition-photos/[0-9a-f-]{36}/competitions)/[A-Za-z0-9_.-]+-w[0-9]{1,5}h[0-9]{1,5}-l5f?\.webp$'
                 OR subject ~ '^old/[0-9a-f-]{36}/[0-9]{1,2}$'),
  attempts   integer     NOT NULL CHECK (attempts >= 1),
  last_error text        NOT NULL,
  last_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.photo_credit_failure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_credit_failure FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.photo_credit_failure IS
  'Credit U3: photos the sweep could not draw. subject = a v3 photo key, or old/<post>/<ord>. Written only by photo_credit_failed().';

CREATE FUNCTION public.photo_credit_parked(_subject text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.photo_credit_failure f
                  WHERE f.subject = _subject AND f.attempts >= 5 AND f.last_at > now() - interval '1 day')
$fn$;
REVOKE ALL ON FUNCTION public.photo_credit_parked(text) FROM PUBLIC, anon, authenticated;

-- ── 2. what is named ────────────────────────────────────────────────────────
CREATE FUNCTION public.photo_set_credit_named()
RETURNS TABLE(photo_key text, owner_id uuid)
LANGUAGE sql STABLE SET search_path TO '' AS $fn$
  WITH c AS (SELECT 'https://' || public.photo_set_backfill_cdn() || '/' AS pfx),
  urls AS (
    SELECT u.url, p.user_id AS owner_id FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) AS u(url)
    UNION ALL
    SELECT u.url, e.user_id FROM public.competition_entries e CROSS JOIN LATERAL unnest(e.photos) AS u(url)
  )
  SELECT DISTINCT ON (k.key) k.key, k.owner_id
    FROM (SELECT substr(urls.url, length(c.pfx) + 1) AS key, urls.owner_id
            FROM urls, c
           WHERE left(urls.url, length(c.pfx)) = c.pfx) k
   WHERE k.key ~ '^(post-images/[0-9a-f-]{36}/posts|competition-photos/[0-9a-f-]{36}/competitions)/[A-Za-z0-9_.-]+-w[0-9]{1,5}h[0-9]{1,5}-l5f?\.webp$'
   ORDER BY k.key, k.owner_id
$fn$;
REVOKE ALL ON FUNCTION public.photo_set_credit_named() FROM PUBLIC, anon, authenticated;

-- ── 3. the worker's three functions ─────────────────────────────────────────
CREATE FUNCTION public.photo_set_credit_queue(_limit integer, _after text)
RETURNS TABLE(photo_key text, owner_full_name text, owner_handle text, owner_is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may read the credit queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.photo_key, pr.full_name, pr.custom_url, public.has_role(n.owner_id, 'admin'::public.app_role)
    FROM public.photo_set_credit_named() n
    LEFT JOIN public.profiles pr ON pr.id = n.owner_id
   WHERE (_after IS NULL OR n.photo_key > _after)
     AND NOT EXISTS (SELECT 1 FROM public.photo_set_credit c WHERE c.photo_key = n.photo_key)
     AND NOT public.photo_credit_parked(n.photo_key)
   ORDER BY n.photo_key
   LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END;
$fn$;

CREATE FUNCTION public.photo_set_credit_target(_key text)
RETURNS TABLE(done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may write credited copies' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT EXISTS (SELECT 1 FROM public.photo_set_credit c WHERE c.photo_key = _key)
    FROM public.photo_set_credit_named() n
   WHERE n.photo_key = _key;
END;
$fn$;

CREATE FUNCTION public.photo_set_credit_record(_key text, _version integer, _drawn boolean, _origin text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may record credited copies' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_set_credit_named() n WHERE n.photo_key = _key) THEN
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

CREATE FUNCTION public.photo_credit_failed(_subject text, _error text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _n integer;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may record a failed photo' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.photo_credit_failure AS f (subject, attempts, last_error)
  VALUES (_subject, 1, left(coalesce(_error, ''), 200))
  ON CONFLICT (subject) DO UPDATE
     SET attempts = f.attempts + 1, last_error = EXCLUDED.last_error, last_at = now()
  RETURNING f.attempts INTO _n;
  RETURN _n;
END;
$fn$;

CREATE FUNCTION public.photo_credit_parked_count()
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-SC-001 only an admin or the converter may read the failed photos' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*) FROM public.photo_credit_failure f WHERE f.attempts >= 5);
END;
$fn$;

-- ── 4. 0109's record, with the version the file really carries ──────────────
CREATE FUNCTION public.photo_old_credit_record(_post_id uuid, _ord integer, _key text, _version integer)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _url text; _uid uuid; _k text; _new text;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-OC-001 only an admin or the converter may record old-credit copies' USING ERRCODE = '42501';
  END IF;
  IF _ord IS NULL OR _ord NOT BETWEEN 0 AND 49 THEN
    RAISE EXCEPTION 'PHOTO-OC-002 ord out of range' USING ERRCODE = '22023';
  END IF;
  IF _version IS NULL OR _version < 5 THEN
    RAISE EXCEPTION 'PHOTO-OC-002 version must be the one renderer''s (5 or later)' USING ERRCODE = '22023';
  END IF;
  SELECT p.image_urls[_ord + 1], p.user_id INTO _url, _uid FROM public.posts p WHERE p.id = _post_id;
  IF public.photo_old_credit_class(_url) IS NULL THEN
    RAISE EXCEPTION 'PHOTO-OC-003 the post does not name an old photo at this place' USING ERRCODE = '22023';
  END IF;
  _k := public.photo_old_credit_key(_post_id, _uid, _ord, _url);
  IF _key IS DISTINCT FROM _k THEN
    RAISE EXCEPTION 'PHOTO-OC-002 the key is not this photo''s credited copy' USING ERRCODE = '22023';
  END IF;
  _new := 'https://' || public.photo_set_backfill_cdn() || '/' || _k;
  INSERT INTO public.photo_old_credit (post_id, ord, src_url, credited_url, credit_version, recorded_by)
  VALUES (_post_id, _ord, _url, _new, _version, auth.uid())
  ON CONFLICT (post_id, ord) DO UPDATE
     SET src_url = EXCLUDED.src_url, credited_url = EXCLUDED.credited_url, credit_version = EXCLUDED.credit_version,
         recorded_by = EXCLUDED.recorded_by, recorded_at = now()
   WHERE public.photo_old_credit.src_url IS DISTINCT FROM EXCLUDED.src_url
      OR public.photo_old_credit.credit_version < EXCLUDED.credit_version;
  DELETE FROM public.photo_credit_failure f WHERE f.subject = 'old/' || _post_id::text || '/' || _ord::text;
  RETURN _new;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.photo_old_credit_queue(_limit integer, _after uuid)
RETURNS TABLE(post_id uuid, ord integer, src_url text, owner_full_name text, owner_handle text, owner_is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-OC-001 only an admin or the converter may read the old-credit queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, (u.i - 1)::integer, u.url, pr.full_name, pr.custom_url,
         public.has_role(p.user_id, 'admin'::public.app_role)
    FROM public.posts p
   CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY AS u(url, i)
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
   WHERE u.i <= 50
     AND (_after IS NULL OR p.id > _after)
     AND public.photo_old_credit_class(u.url) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.photo_old_credit c
                      WHERE c.post_id = p.id AND c.ord = u.i - 1 AND c.src_url = u.url AND c.credit_version >= 4)
     AND NOT public.photo_credit_parked('old/' || p.id::text || '/' || (u.i - 1)::text)
   ORDER BY p.id, u.i
   LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END;
$fn$;

-- ── 5. a rectified photo is drawn by the one renderer ───────────────────────
ALTER TABLE public.photo_l4_rectify ALTER COLUMN credit_version SET DEFAULT 5;

REVOKE ALL ON FUNCTION public.photo_set_credit_queue(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_set_credit_target(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_set_credit_record(text, integer, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_old_credit_record(uuid, integer, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_credit_failed(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_credit_parked_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_set_credit_queue(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_set_credit_target(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_set_credit_record(text, integer, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_old_credit_record(uuid, integer, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_credit_failed(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_credit_parked_count() TO authenticated;

DO $post$
DECLARE _n bigint;
BEGIN
  IF has_table_privilege('anon', 'public.photo_set_credit', 'SELECT') OR has_table_privilege('authenticated', 'public.photo_set_credit', 'SELECT') THEN
    RAISE EXCEPTION 'SC-0111-POST-001: photo_set_credit is readable by anon/authenticated';
  END IF;
  SELECT count(*) INTO _n FROM public.photo_set_credit_named();
  RAISE NOTICE 'SC-0111 applied on %: % v3 photo(s) named', current_setting('p32.lane'), _n;
END
$post$;

COMMIT;
