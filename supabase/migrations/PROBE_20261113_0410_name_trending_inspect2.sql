-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0410 — INSPECT ONLY (second half of 0400, whose trending
-- part stopped on an alias that shadowed the loop variable). READ ONLY.
--   A. the three name triggers a "name never blank" rule must fit between
--   B. a week of likes, public photo / video posts, existing trending flags
-- Counts and structure only — never a member's data.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  f text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  FOREACH f IN ARRAY ARRAY['public.validate_profile_full_name()', 'public.tg_profiles_normalise_name()',
                           'public.tg_profiles_assign_custom_url()', 'public.protect_admin_full_name()'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      RAISE NOTICE 'A BODY %: %', f, pg_get_functiondef(to_regprocedure(f));
    END IF;
  END LOOP;

  RAISE NOTICE 'B LIKES 7d: post_reactions=% on_public_photo_posts=% distinct_posts=% entry_reactions=% portfolio_reactions=%',
    (SELECT count(*) FROM public.post_reactions WHERE created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.post_reactions x JOIN public.posts po ON po.id = x.post_id
      WHERE x.created_at > now() - interval '7 days' AND po.privacy = 'public'
        AND (cardinality(po.image_urls) > 0 OR po.image_url IS NOT NULL)),
    (SELECT count(DISTINCT post_id) FROM public.post_reactions WHERE created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.image_reactions WHERE image_type = 'competition_entry' AND created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.image_reactions WHERE image_type = 'portfolio' AND created_at > now() - interval '7 days');
  RAISE NOTICE 'B POSTS: public_photo=% public_photo_30d=% public_video=% public_video_ready=%',
    (SELECT count(*) FROM public.posts WHERE privacy = 'public' AND (cardinality(image_urls) > 0 OR image_url IS NOT NULL)),
    (SELECT count(*) FROM public.posts WHERE privacy = 'public' AND (cardinality(image_urls) > 0 OR image_url IS NOT NULL) AND created_at > now() - interval '30 days'),
    (SELECT count(*) FROM public.posts po JOIN public.post_videos pv ON pv.post_id = po.id WHERE po.privacy = 'public'),
    (SELECT count(*) FROM public.posts po JOIN public.post_videos pv ON pv.post_id = po.id JOIN public.videos v ON v.id = pv.video_id
      WHERE po.privacy = 'public' AND v.state = 'ready' AND v.deleted_at IS NULL);
  RAISE NOTICE 'B TOP 7d (counts only): %', (
    SELECT string_agg(n::text, ',') FROM (
      SELECT count(*) n FROM public.post_reactions x JOIN public.posts po ON po.id = x.post_id
       WHERE x.created_at > now() - interval '7 days' AND po.privacy = 'public'
         AND (cardinality(po.image_urls) > 0 OR po.image_url IS NOT NULL)
       GROUP BY x.post_id ORDER BY 1 DESC LIMIT 8) t);
  RAISE NOTICE 'B TABLES with is_trending: %', (
    SELECT string_agg(c.relname, ', ') FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
     WHERE a.attname = 'is_trending' AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r');
  RAISE NOTICE 'B SITE SETTINGS like trend: %', (SELECT string_agg(key, ', ') FROM public.site_settings WHERE key ILIKE '%trend%');
  RAISE NOTICE 'B FEATURE KEYS: %', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feature_access_feature_check');
  RAISE NOTICE 'B can_view_post: %', (SELECT string_agg(oid::regprocedure::text, ' ; ') FROM pg_proc WHERE proname = 'can_view_post');

  RAISE NOTICE 'NT0410 INSPECT DONE (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
