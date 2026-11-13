-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0400 — INSPECT ONLY, before building (Owner 13 Nov):
--   A. "always the name, never Photographer"  → how many members have no name,
--      what the signup trigger writes, what a handle could give them
--   B. "Trending this week: 4 photos, or 1 admin-marked video" → what a week of
--      likes really is, how many public photo posts / video posts exist
-- READ ONLY, ROLLBACK. Counts and structure only — never a member's data.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  r record;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- ── A. names ──────────────────────────────────────────────────────────────
  RAISE NOTICE 'A PROFILES: total=% name_null=% name_blank=% blank_with_handle=% blank_no_handle=%',
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.profiles WHERE full_name IS NULL),
    (SELECT count(*) FROM public.profiles WHERE full_name IS NOT NULL AND btrim(full_name) = ''),
    (SELECT count(*) FROM public.profiles WHERE coalesce(btrim(full_name), '') = '' AND coalesce(btrim(custom_url), '') <> ''),
    (SELECT count(*) FROM public.profiles WHERE coalesce(btrim(full_name), '') = '' AND coalesce(btrim(custom_url), '') = '');
  RAISE NOTICE 'A NAMELESS WITH POSTS: members=% posts=%',
    (SELECT count(DISTINCT p.user_id) FROM public.posts p JOIN public.profiles pr ON pr.id = p.user_id WHERE coalesce(btrim(pr.full_name), '') = ''),
    (SELECT count(*) FROM public.posts p JOIN public.profiles pr ON pr.id = p.user_id WHERE coalesce(btrim(pr.full_name), '') = '');
  RAISE NOTICE 'A COL profiles.full_name: %', (
    SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' nullable' END
      FROM pg_attribute a WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'full_name');
  RAISE NOTICE 'A CHECKS on profiles: %', (
    SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), ' ; ') FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND contype = 'c');
  FOR r IN SELECT t.tgname, p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal LOOP
    RAISE NOTICE 'A AUTH TRIGGER % -> %()', r.tgname, r.proname;
  END LOOP;
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    RAISE NOTICE 'A BODY handle_new_user: %', pg_get_functiondef('public.handle_new_user()'::regprocedure);
  END IF;
  FOR r IN SELECT t.tgname, p.proname, t.tgtype FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal LOOP
    RAISE NOTICE 'A PROFILES TRIGGER % -> %() type=%', r.tgname, r.proname, r.tgtype;
  END LOOP;

  -- ── B. trending ───────────────────────────────────────────────────────────
  RAISE NOTICE 'B LIKES 7d: post_reactions=% on_public_photo_posts=% distinct_posts=% entry_reactions=% portfolio_reactions=%',
    (SELECT count(*) FROM public.post_reactions WHERE created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.post_reactions r JOIN public.posts p ON p.id = r.post_id
      WHERE r.created_at > now() - interval '7 days' AND p.privacy = 'public'
        AND (cardinality(p.image_urls) > 0 OR p.image_url IS NOT NULL)),
    (SELECT count(DISTINCT post_id) FROM public.post_reactions WHERE created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.image_reactions WHERE image_type = 'competition_entry' AND created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.image_reactions WHERE image_type = 'portfolio' AND created_at > now() - interval '7 days');
  RAISE NOTICE 'B POSTS: public_photo_posts=% public_photo_posts_30d=% public_video_posts=% ready_videos=%',
    (SELECT count(*) FROM public.posts WHERE privacy = 'public' AND (cardinality(image_urls) > 0 OR image_url IS NOT NULL)),
    (SELECT count(*) FROM public.posts WHERE privacy = 'public' AND (cardinality(image_urls) > 0 OR image_url IS NOT NULL) AND created_at > now() - interval '30 days'),
    (SELECT count(*) FROM public.posts p JOIN public.post_videos pv ON pv.post_id = p.id WHERE p.privacy = 'public'),
    (SELECT count(*) FROM public.posts p JOIN public.post_videos pv ON pv.post_id = p.id JOIN public.videos v ON v.id = pv.video_id
      WHERE p.privacy = 'public' AND v.state = 'ready' AND v.deleted_at IS NULL);
  RAISE NOTICE 'B COLS posts: %', (
    SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) FROM pg_attribute a
     WHERE a.attrelid = 'public.posts'::regclass AND a.attnum > 0 AND NOT a.attisdropped);
  RAISE NOTICE 'B TABLES with is_trending: %', (
    SELECT string_agg(c.relname, ', ') FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
     WHERE a.attname = 'is_trending' AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r');
  RAISE NOTICE 'B SITE SETTINGS like trend: %', (
    SELECT string_agg(key, ', ') FROM public.site_settings WHERE key ILIKE '%trend%');
  RAISE NOTICE 'B FEATURE KEYS: %', (
    SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feature_access_feature_check');

  RAISE NOTICE 'NT0400 INSPECT DONE (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
