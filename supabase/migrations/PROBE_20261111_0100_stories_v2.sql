-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261111_0100 stories v2 — ENDS IN ROLLBACK (nothing it does stays).
-- FAIL before 0100 (objects missing); PASS after. Prints COUNTS ONLY.
--
--   P1  structure: stories.post_id, the two tables (RLS on, no SELECT for the
--       API roles), the six functions SECURITY DEFINER, grants as intended,
--       notification type story_comment registered, clean-up scheduled
--   P2  STAGING ONLY — behaviour, as real members, inside this rolled-back
--       transaction: post → story (idempotent); a friends-only post's story is
--       hidden from a non-friend; a client cannot insert a post story; like +
--       comment on a plain story; the list shows it; deleting the post deletes
--       its story; a stranger's story cannot go into your highlight.
--   P3  live counts: live stories · from posts · likes · story comments
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE
  _n bigint; _a uuid; _b uuid; _pub uuid; _fr uuid; _s1 uuid; _s1b uuid; _s2 uuid; _plain uuid; _h uuid;
  _ok boolean;
BEGIN
  RAISE NOTICE 'PROBE 0100 lane % at %', coalesce(current_setting('p32.lane', true), '?'), now();

  -- P1 · structure
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'stories' AND column_name = 'post_id') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: stories.post_id is missing (expected before 0100 is applied)';
  END IF;
  IF to_regclass('public.story_likes') IS NULL OR to_regclass('public.story_comments') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P1: story_likes / story_comments missing';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.story_likes'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.story_comments'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL P1: RLS is off on a new table';
  END IF;
  IF has_table_privilege('anon', 'public.story_comments', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.story_likes', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.story_comments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.story_likes', 'SELECT') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: a new table is readable by the API roles';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.story_visible(uuid,uuid)'), to_regprocedure('public.get_feed_stories_bar()'),
                   to_regprocedure('public.get_user_stories(uuid)'), to_regprocedure('public.story_add_post(uuid)'),
                   to_regprocedure('public.story_comments_list(uuid,integer)'), to_regprocedure('public.story_cleanup()'))
     AND p.prosecdef;
  IF _n <> 6 THEN RAISE EXCEPTION 'PROBE FAIL P1: % of 6 functions are SECURITY DEFINER', _n; END IF;
  IF has_function_privilege('anon', 'public.story_add_post(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_user_stories(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.story_cleanup()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_feed_stories_bar()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.story_add_post(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: function grants are not as intended';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_types WHERE type = 'story_comment' AND group_key = 'likes_comments') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: notification type story_comment not registered';
  END IF;
  IF public.notif_action_phrase('story_comment') IS DISTINCT FROM 'commented on your story.' THEN
    RAISE EXCEPTION 'PROBE FAIL P1: bell wording for story_comment missing';
  END IF;
  IF to_regnamespace('cron') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stories-cleanup' AND active) THEN
    RAISE EXCEPTION 'PROBE FAIL P1: stories-cleanup is not scheduled';
  END IF;

  -- P2 · behaviour (staging only)
  IF current_setting('p32.lane', true) = 'staging' THEN
    SELECT p1.id, p2.id INTO _a, _b
      FROM public.profiles p1 JOIN auth.users u1 ON u1.id = p1.id
      CROSS JOIN public.profiles p2 JOIN auth.users u2 ON u2.id = p2.id
     WHERE p1.id <> p2.id AND NOT public.is_banned(p1.id) AND NOT public.is_banned(p2.id)
       AND NOT public.are_friends(p1.id, p2.id)
     LIMIT 1;
    IF _b IS NULL THEN RAISE EXCEPTION 'PROBE FAIL P2: no two non-friend members on staging to test with'; END IF;

    INSERT INTO public.posts (user_id, content, privacy, image_urls)
    VALUES (_a, 'probe 0100 public', 'public', ARRAY['https://example.invalid/probe-a.jpg']) RETURNING id INTO _pub;
    INSERT INTO public.posts (user_id, content, privacy, image_urls)
    VALUES (_a, 'probe 0100 friends', 'friends', ARRAY['https://example.invalid/probe-b.jpg']) RETURNING id INTO _fr;

    -- as member A
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    _s1  := public.story_add_post(_pub);
    _s1b := public.story_add_post(_pub);
    _s2  := public.story_add_post(_fr);
    IF _s1 IS NULL OR _s1 <> _s1b THEN RAISE EXCEPTION 'PROBE FAIL P2: story_add_post is not idempotent'; END IF;
    INSERT INTO public.stories (user_id, image_url) VALUES (_a, 'https://example.invalid/probe-plain.jpg')
      RETURNING id INTO _plain;
    _ok := false;
    BEGIN
      INSERT INTO public.stories (user_id, image_url, post_id) VALUES (_a, 'https://example.invalid/x.jpg', _fr);
    EXCEPTION WHEN insufficient_privilege OR unique_violation OR check_violation THEN _ok := true;
    END;
    IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL P2: a client inserted a post story directly'; END IF;
    SELECT count(*) INTO _n FROM public.get_user_stories(_a);
    IF _n <> 3 THEN RAISE EXCEPTION 'PROBE FAIL P2: the owner sees % of 3 own stories', _n; END IF;

    -- as member B (not a friend of A)
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO _n FROM public.get_user_stories(_a);
    IF _n <> 2 THEN RAISE EXCEPTION 'PROBE FAIL P2: a non-friend sees % stories (expected 2: public post + plain)', _n; END IF;
    SELECT count(*) INTO _n FROM public.stories WHERE id = _s2;
    IF _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL P2: the friends-only story is readable by a non-friend'; END IF;
    _ok := false;
    BEGIN
      _h := public.story_add_post(_pub);
    EXCEPTION WHEN insufficient_privilege THEN _ok := true;
    END;
    IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL P2: B added A''s post to a story'; END IF;
    INSERT INTO public.story_likes (story_id, user_id) VALUES (_plain, _b);
    INSERT INTO public.story_comments (story_id, user_id, content, idempotency_key) VALUES (_plain, _b, 'probe comment', 'probe-0100');
    SELECT count(*) INTO _n FROM public.story_comments_list(_plain, 50);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P2: the story shows % of 1 comment', _n; END IF;
    SELECT like_count + comment_count INTO _n FROM public.get_user_stories(_a) WHERE id = _plain;
    IF _n <> 2 THEN RAISE EXCEPTION 'PROBE FAIL P2: counts on the plain story read % (expected 1 like + 1 comment)', _n; END IF;
    _ok := false;
    BEGIN
      INSERT INTO public.story_comments (story_id, user_id, content) VALUES (_s2, _b, 'should not land');
    EXCEPTION WHEN insufficient_privilege THEN _ok := true;
    END;
    IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL P2: a comment landed on a story the member cannot see'; END IF;

    -- back as postgres: notification, highlight guard, cascade
    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) INTO _n FROM public.notification_centre_log WHERE type = 'story_comment' AND recipient_id = _a;
    RAISE NOTICE '  story_comment centre decisions logged for the owner: % (0 = likes_comments group not live on this lane)', _n;
    INSERT INTO public.highlights (user_id, title) VALUES (_b, 'probe') RETURNING id INTO _h;
    _ok := false;
    BEGIN
      INSERT INTO public.highlight_items (highlight_id, image_url, story_id) VALUES (_h, 'https://example.invalid/h.jpg', _plain);
    EXCEPTION WHEN check_violation THEN _ok := true;
    END;
    IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL P2: a stranger''s story went into a highlight'; END IF;
    DELETE FROM public.posts WHERE id = _pub;
    IF EXISTS (SELECT 1 FROM public.stories WHERE id = _s1) THEN
      RAISE EXCEPTION 'PROBE FAIL P2: deleting the post left its story';
    END IF;
    RAISE NOTICE '  P2 behaviour: all checks passed (rolled back)';
  ELSE
    RAISE NOTICE '  P2 behaviour: skipped on this lane (runs on staging only)';
  END IF;

  -- P3 · counts
  SELECT count(*) INTO _n FROM public.stories WHERE expires_at > now();
  RAISE NOTICE '  live stories: % · from posts: % · likes: % · story comments: %', _n,
    (SELECT count(*) FROM public.stories WHERE expires_at > now() AND post_id IS NOT NULL),
    (SELECT count(*) FROM public.story_likes), (SELECT count(*) FROM public.story_comments);
  RAISE NOTICE 'PROBE PASS 0100 (live stories: %)', _n;
END
$p$;
ROLLBACK;
