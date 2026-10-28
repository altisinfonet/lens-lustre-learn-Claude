-- ═══════════════════════════════════════════════════════════════════════════
-- S3-c · 20261029_0101 — resolved post media (the derivative ladder) behind
-- the switch `media_ladder_feed`. Lanes: staging and production.
-- Design: docs/evidence/d2/S3/DESIGN.md §4 (D-S3-1), §7.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ADDS (expand only):
--   · switch 'media_ladder_feed' in public.feature_access — created OFF, audited.
--   · public.post_media_resolved_for(uuid[]) — the companion read the client
--     calls with a page's post ids ALONGSIDE post_media_for (in parallel) when
--     the switch is on for that member; resolved posts use it, others keep today's. Returns ONLY
--         post_id · ord · media_id · width · height · mime · url
--     one row per stored rung (600 / 1080 / 1440 WebP); the URL is built HERE
--     from the lane's CDN origin (site_settings.s3_storage_settings.public_url).
--     Never sha256, derivatives, state, verified_at or a quarantine reason, and
--     never the original.
--
-- RULES, in the function:
--   · can_view_post(viewer, author, privacy) is the access control (as in
--     post_media_for). ⚠ DO NOT REMOVE.
--   · Nothing unless feature_allowed('media_ladder_feed', viewer).
--   · ALL OR NOTHING PER POST: a post is returned only when every one of its
--     media objects has its full ladder; otherwise the post is absent and the
--     client falls back to today's path for it (no mixed albums).
--   · Non-public posts: no rows in this file (they fall back to today). 0102
--     (S3-d) adds the private branch behind `media_private_photos`.
--   · Capped at 50 ids (MEDIA-1001), as post_media_for.
--   · A public_url that is not a bare https origin → no rows (fallback), never
--     a guessed host.
--
-- NOT RE-RUNNABLE: PRE-002 refuses once post_media_resolved_for exists.
-- ROLLBACK: supabase/rollback/20261029_0101_s3c_post_media_resolved_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_s3c_post_media_resolved.sql
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

DO $preconditions$
DECLARE _def text;
BEGIN
  IF to_regprocedure('public.media_derivative_key(uuid,uuid,text,integer)') IS NULL
     OR to_regprocedure('public.media_rung_dims(integer,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'S3C-0101-PRE-001: apply 20261029_0100 first' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.feature_allowed(text,uuid)') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL
     OR to_regclass('public.site_settings') IS NULL THEN
    RAISE EXCEPTION 'S3C-0101-PRE-001: feature_allowed, can_view_post or site_settings is missing' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.post_media_resolved_for(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'S3C-0101-PRE-002: post_media_resolved_for() already exists — 20261029_0101 is applied' USING ERRCODE = 'raise_exception';
  END IF;
  -- The switch list must be exactly what this file expects to extend (no other unit
  -- added a feature since 20261018_0003); otherwise stop rather than drop someone's row.
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
   WHERE conrelid = 'public.feature_access'::regclass AND conname = 'feature_access_feature_check';
  IF _def IS NULL OR _def !~ 'personal_feed' OR _def ~ 'media_' THEN
    RAISE EXCEPTION 'S3C-0101-PRE-003: feature_access_feature_check is not the 20261018_0003 list (read: %)', coalesce(_def, '<none>')
      USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feature_access
              WHERE feature NOT IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed')) THEN
    RAISE EXCEPTION 'S3C-0101-PRE-003: feature_access holds a feature this file does not know' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the switch, OFF ──────────────────────────────────────────────────────
ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check;
ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
  CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed',
                     'media_ladder_feed', 'media_private_photos'));
-- (media_private_photos is allowed by the constraint now so 0102 needs no second
--  constraint swap; its ROW is created by 0102, OFF.)
INSERT INTO public.feature_access (feature, mode) VALUES ('media_ladder_feed', 'off');
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
VALUES (NULL, 'media_ladder_feed', 'mode', NULL, 'off', '20261029_0101: switch created, Off');

-- ── 2. the lane's CDN origin, read on the server ───────────────────────────
CREATE FUNCTION public.media_cdn_origin()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT CASE WHEN o ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN o END
    FROM (SELECT rtrim(lower(s.value->>'public_url'), '/') AS o
            FROM public.site_settings s WHERE s.key = 's3_storage_settings') x;
$fn$;
REVOKE ALL ON FUNCTION public.media_cdn_origin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_cdn_origin() TO service_role;

-- ── 3. the resolved read ────────────────────────────────────────────────────
CREATE FUNCTION public.post_media_resolved_for(_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, media_id uuid, width integer, height integer, mime text, url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid()); _origin text;
BEGIN
  IF _post_ids IS NULL OR array_length(_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'MEDIA-1001 at most 50 post ids per call, got %', array_length(_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  IF NOT public.feature_allowed('media_ladder_feed', _uid) THEN RETURN; END IF;
  _origin := public.media_cdn_origin();
  IF _origin IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH vis AS (
    SELECT p.id AS pid
      FROM public.posts p
     WHERE p.id = ANY(_post_ids)
       AND p.privacy = 'public'
       -- ⚠ DO NOT REMOVE. This is the access control.
       AND public.can_view_post(_uid, p.user_id, p.privacy)
  ), slides AS (
    SELECT pm.post_id AS pid, pm.ord AS o, mo.id AS mid, mo.owner_id AS own, mo.width AS w, mo.height AS h,
           (mo.state = 'ready' AND mo.derivatives ?& ARRAY['600', '1080', '1440']) AS complete
      FROM vis JOIN public.post_media pm ON pm.post_id = vis.pid
      JOIN public.media_objects mo ON mo.id = pm.media_id
  ), whole AS (
    SELECT s.pid FROM slides s GROUP BY s.pid HAVING bool_and(s.complete)
  )
  SELECT s.pid, s.o, s.mid, d.width, d.height, 'image/webp'::text,
         _origin || '/' || public.media_derivative_key(s.own, s.mid, 'public', r.x)
    FROM slides s
    JOIN whole USING (pid)
   CROSS JOIN unnest(ARRAY[600, 1080, 1440]) r(x)
   CROSS JOIN LATERAL public.media_rung_dims(s.w, s.h, r.x) d
   ORDER BY s.pid, s.o, r.x;
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_media_resolved_for(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_media_resolved_for(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.post_media_resolved_for(uuid[]) IS
  'S3-c: resolved post media (600/1080/1440 WebP derivatives) for posts the caller can view, only while '
  'feature media_ladder_feed is on for them. Returns post_id, ord, media_id, width, height, mime, url only. '
  'All or nothing per post. Capped at 50 ids (MEDIA-1001).';

COMMIT;
