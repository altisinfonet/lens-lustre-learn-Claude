-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S3-b derivative coverage (read-only, staging and production)
-- Reports COUNTS and PERCENTAGES only (public log). Changes nothing; ends in
-- ROLLBACK. Run it before the backfill (baseline), after each run, and before
-- any client switch: the S3 rule is 100 % before `media_ladder_feed` leaves off.
--
-- Strict mode: run with  SET s3.require_full = 'on';  first → it RAISES unless
-- every ready media object referenced by a post has its full ladder for every
-- audience it needs. Needs 20261029_0100 (media_derivative_key).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET TRANSACTION READ ONLY;

DO $cov$
DECLARE
  posts_with_images int; posts_in_graph int; legacy_only_posts int;
  need_pub int; full_pub int; need_priv int; full_priv int; not_ready int; pct numeric;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  SELECT count(*) INTO posts_with_images FROM public.posts p
   WHERE coalesce(cardinality(p.image_urls), 0) > 0 OR coalesce(p.image_url, '') <> '';
  SELECT count(DISTINCT pm.post_id) INTO posts_in_graph FROM public.post_media pm;
  SELECT count(*) INTO legacy_only_posts FROM public.posts p
   WHERE (coalesce(cardinality(p.image_urls), 0) > 0 OR coalesce(p.image_url, '') <> '')
     AND NOT EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id);

  WITH need AS (
    SELECT DISTINCT pm.media_id, CASE WHEN p.privacy = 'public' THEN '' ELSE 'p' END AS pre
      FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
  )
  SELECT count(*) FILTER (WHERE n.pre = ''),
         count(*) FILTER (WHERE n.pre = '' AND mo.derivatives ?& ARRAY['600', '1080', '1440']),
         count(*) FILTER (WHERE n.pre = 'p'),
         count(*) FILTER (WHERE n.pre = 'p' AND mo.derivatives ?& ARRAY['p600', 'p1080', 'p1440']),
         count(*) FILTER (WHERE mo.state <> 'ready')
    INTO need_pub, full_pub, need_priv, full_priv, not_ready
    FROM need n JOIN public.media_objects mo ON mo.id = n.media_id;

  pct := CASE WHEN need_pub + need_priv = 0 THEN 100
              ELSE round(100.0 * (full_pub + full_priv) / (need_pub + need_priv), 1) END;

  RAISE NOTICE 'S3 COVERAGE (lane %): % %% — public ladder %/%, private ladder %/%, referenced media not ready %; posts with images %, in media graph %, legacy-only (fallback, outside the ladder) %',
    current_setting('p32.lane', true), pct, full_pub, need_pub, full_priv, need_priv, not_ready,
    posts_with_images, posts_in_graph, legacy_only_posts;

  -- Strict mode compares RAW COUNTS (a rounded 100.0 % can hide a missing ladder).
  IF coalesce(current_setting('s3.require_full', true), '') = 'on'
     AND (full_pub <> need_pub OR full_priv <> need_priv OR not_ready <> 0) THEN
    RAISE EXCEPTION 'PROBE FAIL: derivative coverage incomplete — public %/%, private %/%, not ready % (strict mode requires all)',
      full_pub, need_pub, full_priv, need_priv, not_ready;
  END IF;
END
$cov$;

ROLLBACK;
