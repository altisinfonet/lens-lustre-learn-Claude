-- ═══════════════════════════════════════════════════════════════════════════
-- S3-d · 20261029_0102 — friends-only / only-me photos through private delivery
-- behind the switch `media_private_photos`. Lanes: staging and production.
-- Design: docs/evidence/d2/S3/DESIGN.md §3 (O-1), §4, §7, §10.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CHANGES (expand + behaviour behind an OFF switch):
--   · switch 'media_private_photos' in public.feature_access — created OFF,
--     audited (20261029_0101 already admits the name in the constraint).
--   · public.post_media_resolved_for(uuid[]) — same signature, same 7 columns,
--     one new branch: a NON-PUBLIC post the caller can view (can_view_post) is
--     returned only while media_private_photos is on for the caller, all or
--     nothing per post, with URLs  <cdn origin>/photo/<owner>/<media>/w<rung>.webp
--     — objects in the video bucket that ONLY the media-authz Worker serves, with
--     a photo pass (functions/api/media/photo-token.ts mints it by calling THIS
--     function as the member). Switch off → exactly the 0101 behaviour.
--   · Old builds and today's URLs: untouched (O-1 — friends-only ORIGINALS stay
--     at their public URLs until a later contract stage; PrivacyGapNotice stays).
--
-- NOT RE-RUNNABLE: PRE-002 refuses once the switch row exists.
-- ROLLBACK: supabase/rollback/20261029_0102_s3d_private_photos_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_s3d_private_photos.sql
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
BEGIN
  IF to_regprocedure('public.post_media_resolved_for(uuid[])') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'media_ladder_feed') THEN
    RAISE EXCEPTION 'S3D-0102-PRE-001: apply 20261029_0101 first' USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'media_private_photos') THEN
    RAISE EXCEPTION 'S3D-0102-PRE-002: media_private_photos exists — 20261029_0102 is applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

INSERT INTO public.feature_access (feature, mode) VALUES ('media_private_photos', 'off');
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
VALUES (NULL, 'media_private_photos', 'mode', NULL, 'off', '20261029_0102: switch created, Off');

CREATE OR REPLACE FUNCTION public.post_media_resolved_for(_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, media_id uuid, width integer, height integer, mime text, url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid()); _origin text; _priv boolean;
BEGIN
  IF _post_ids IS NULL OR array_length(_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'MEDIA-1001 at most 50 post ids per call, got %', array_length(_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  IF NOT public.feature_allowed('media_ladder_feed', _uid) THEN RETURN; END IF;
  _priv := public.feature_allowed('media_private_photos', _uid);
  _origin := public.media_cdn_origin();
  IF _origin IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH vis AS (
    SELECT p.id AS pid, CASE WHEN p.privacy = 'public' THEN 'public' ELSE 'private' END AS tgt
      FROM public.posts p
     WHERE p.id = ANY(_post_ids)
       -- non-public posts only through the private branch, and only while its switch is on
       AND (p.privacy = 'public' OR _priv)
       -- ⚠ DO NOT REMOVE. This is the access control.
       AND public.can_view_post(_uid, p.user_id, p.privacy)
  ), slides AS (
    SELECT pm.post_id AS pid, vis.tgt, pm.ord AS o, mo.id AS mid, mo.owner_id AS own, mo.width AS w, mo.height AS h,
           (mo.state = 'ready' AND mo.derivatives ?& (CASE WHEN vis.tgt = 'public' THEN ARRAY['600', '1080', '1440']
                                                          ELSE ARRAY['p600', 'p1080', 'p1440'] END)) AS complete
      FROM vis JOIN public.post_media pm ON pm.post_id = vis.pid
      JOIN public.media_objects mo ON mo.id = pm.media_id
  ), whole AS (
    SELECT s.pid FROM slides s GROUP BY s.pid HAVING bool_and(s.complete)
  )
  SELECT s.pid, s.o, s.mid, d.width, d.height, 'image/webp'::text,
         _origin || '/' || public.media_derivative_key(s.own, s.mid, s.tgt, r.x)
    FROM slides s
    JOIN whole USING (pid)
   CROSS JOIN unnest(ARRAY[600, 1080, 1440]) r(x)
   CROSS JOIN LATERAL public.media_rung_dims(s.w, s.h, r.x) d
   ORDER BY s.pid, s.o, r.x;
END;
$fn$;

-- Privileges are kept by CREATE OR REPLACE; restated so the file reads whole.
REVOKE ALL ON FUNCTION public.post_media_resolved_for(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_media_resolved_for(uuid[]) TO authenticated;

COMMIT;
