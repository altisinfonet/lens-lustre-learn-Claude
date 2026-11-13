-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0090 — INSPECT ONLY, before @all / @followers is built
-- (Owner plan 2026-11-12). READ ONLY, ROLLBACK. Prints structure and counts,
-- never a member's data: the columns, triggers and function bodies the build
-- must fit, measured on the running database instead of read from old files.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  r record;
  t text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  FOREACH t IN ARRAY ARRAY['posts', 'post_comments', 'follows', 'user_badges', 'notification_preferences',
                           'user_blocks', 'user_notifications', 'site_settings', 'user_roles'] LOOP
    RAISE NOTICE 'COLS %: %', t, (
      SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                        || CASE WHEN a.attnotnull THEN ' NN' ELSE '' END, ', ' ORDER BY a.attnum)
        FROM pg_attribute a WHERE a.attrelid = to_regclass('public.' || t) AND a.attnum > 0 AND NOT a.attisdropped);
  END LOOP;
  RAISE NOTICE 'COLS profiles (subset): %', (
    SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname ~ '(suspend|deleted|banned|custom_url|full_name|^id$|username|is_)');

  FOR r IN SELECT c.relname, tg.tgname, p.proname, tg.tgenabled, tg.tgtype
             FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE NOT tg.tgisinternal AND c.relnamespace = 'public'::regnamespace
              AND c.relname IN ('posts', 'post_comments', 'user_notifications', 'user_badges')
            ORDER BY 1, 2 LOOP
    RAISE NOTICE 'TRIGGER %.% -> %() enabled=% type=%', r.relname, r.tgname, r.proname, r.tgenabled, r.tgtype;
  END LOOP;

  FOR r IN SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('has_role', 'is_admin', 'can_view_post', 'is_banned', 'account_is_live', 'notif_admin_or_raise',
                                'notification_centre_emit', 'notification_centre_decide', 'notification_centre_live',
                                'notif_action_phrase', 'notif_group_key', 'feature_allowed_me', 'feature_allowed',
                                'get_primary_admin_user_id', 'notify_post_comment', 'notify_post_tag', 'pj_handle_tag_notification',
                                'is_verified_member', 'publish_post_atomic', 'enforce_comment_blocklist')
            ORDER BY 1 LOOP
    RAISE NOTICE 'FUNC % secdef=% vol=%', r.sig, r.prosecdef, r.provolatile;
  END LOOP;

  RAISE NOTICE 'BODY notif_action_phrase: %', pg_get_functiondef('public.notif_action_phrase(text)'::regprocedure);
  RAISE NOTICE 'BODY notif_group_key: %', pg_get_functiondef('public.notif_group_key(text,timestamp with time zone,uuid)'::regprocedure);
  RAISE NOTICE 'BODY notify_post_comment: %', pg_get_functiondef('public.notify_post_comment()'::regprocedure);
  IF to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NOT NULL THEN
    RAISE NOTICE 'BODY can_view_post: %', pg_get_functiondef('public.can_view_post(uuid,uuid,text)'::regprocedure);
  END IF;
  IF to_regprocedure('public.feature_allowed_me(text)') IS NOT NULL THEN
    RAISE NOTICE 'BODY feature_allowed_me: %', pg_get_functiondef('public.feature_allowed_me(text)'::regprocedure);
  END IF;

  RAISE NOTICE 'TYPES (mention-like / tag): %', (
    SELECT string_agg(format('%s[%s|%s|in=%s|push=%s|by=%s|dedup=%s|rate=%s|on=%s]', nt.type, nt.group_key, array_to_string(nt.channels, '+'),
                             coalesce(nt.pref_in_app, '-'), coalesce(nt.pref_push, '-'), nt.group_by, nt.dedup_window, coalesce(nt.rate_per_hour::text, '-'), nt.enabled), ' ; ')
      FROM public.notification_types nt WHERE nt.type IN ('post_tag', 'admin_announcement', 'new_post_from_following', 'post_comment', 'story_comment'));
  RAISE NOTICE 'CENTRE SWITCHES: %', (
    SELECT string_agg(s.key || '=' || CASE WHEN jsonb_typeof(s.value) = 'object' THEN 'chosen(' || coalesce(jsonb_array_length(s.value -> 'users'), 0) || ')' ELSE s.value::text END, ', ')
      FROM public.site_settings s WHERE s.key LIKE 'notif_centre_%');
  RAISE NOTICE 'BADGE TYPES: %', (SELECT string_agg(badge_type || '=' || n, ', ') FROM (SELECT badge_type, count(*) n FROM public.user_badges GROUP BY 1) b);
  RAISE NOTICE 'POST PRIVACY VALUES: %', (SELECT string_agg(privacy || '=' || n, ', ') FROM (SELECT privacy, count(*) n FROM public.posts GROUP BY 1) b);
  RAISE NOTICE 'COUNTS: profiles=% follows=% max_followers_of_one=% blocks=%',
    (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.follows),
    (SELECT coalesce(max(n), 0) FROM (SELECT count(*) n FROM public.follows GROUP BY following_id) f),
    (SELECT count(*) FROM public.user_blocks);
  RAISE NOTICE 'CRON: %', (SELECT string_agg(jobname || ' [' || schedule || ']', ', ') FROM cron.job);
  RAISE NOTICE 'NAMES TAKEN (all/followers/everyone): %', (
    SELECT count(*) FROM public.profiles p WHERE lower(coalesce(p.custom_url, '')) IN ('all', 'followers', 'everyone'));
  RAISE NOTICE 'MG0090 INSPECT DONE (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
