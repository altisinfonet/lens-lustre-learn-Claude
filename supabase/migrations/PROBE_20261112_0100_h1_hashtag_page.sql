-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261112_0100 H1 hashtag page — ENDS IN ROLLBACK.
-- FAIL before 0100 (functions missing); PASS after. Prints COUNTS ONLY.
--
--   P1  structure: 4 functions, page functions callable by anon, follow functions
--       not; hashtag_follows not writable by clients; post_created_at NOT NULL
--   P2  rule: every language, first-seen order, NFC, ≤ 30 per post, danda ends a tag
--   P3  STAGING ONLY — real members A and B (not friends), inside this rolled-back
--       transaction: A posts public "#probeh1 #প্রোবএইচ১", friends-only "#probeh1",
--       public "#probeh1x". Then
--         anon   sees 1 post on #probeh1 (public only; #probeh1x is NOT #probeh1)
--         B      sees 1 (not A's friend)
--         A      sees 2 (own friends-only post)
--         anon   sees 1 on #প্রোবএইচ১; info says 1 photographer · 1 post (public)
--         recent paging 1 + 1 with the cursor; top cursor is a number
--         B follows → is_following true; unfollows → false; anon follow refused
--         a 40-tag post keeps 30 junction rows
--   P4  live counts: hashtags, post tags, tags outside ASCII, follows
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE
  _n bigint; _a uuid; _b uuid; _p1 uuid; _p2 uuid; _p3 uuid; _p4 uuid;
  _cur text; _ok boolean; _info record; _bn text := normalize('প্রোবএইচ১', NFC);
BEGIN
  RAISE NOTICE 'PROBE H1-0100 lane % at %', coalesce(current_setting('p32.lane', true), '?'), now();

  -- P1 · structure
  IF to_regprocedure('public.hashtag_page_posts(text,text,text,integer)') IS NULL
     OR to_regprocedure('public.hashtag_page_info(text)') IS NULL
     OR to_regprocedure('public.follow_hashtag(text)') IS NULL
     OR to_regprocedure('public.unfollow_hashtag(text)') IS NULL
     OR to_regclass('public.hashtag_follows') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P1: H1 objects missing (expected before 0100 is applied)';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.hashtag_page_posts(text,text,text,integer)'),
                   to_regprocedure('public.hashtag_page_info(text)'),
                   to_regprocedure('public.follow_hashtag(text)'),
                   to_regprocedure('public.unfollow_hashtag(text)'))
     AND p.prosecdef;
  IF _n <> 4 THEN RAISE EXCEPTION 'PROBE FAIL P1: % of 4 functions are SECURITY DEFINER', _n; END IF;
  IF NOT has_function_privilege('anon', 'public.hashtag_page_posts(text,text,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.hashtag_page_info(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.follow_hashtag(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.unfollow_hashtag(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.follow_hashtag(text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.hashtag_follows', 'INSERT')
     OR has_table_privilege('authenticated', 'public.hashtag_follows', 'DELETE')
     OR has_table_privilege('anon', 'public.hashtag_follows', 'SELECT') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: grants are not as intended';
  END IF;
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'post_hashtags' AND column_name = 'post_created_at' AND is_nullable = 'NO';
  IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P1: post_hashtags.post_created_at missing or nullable'; END IF;

  -- P2 · the rule
  IF public.extract_hashtags('Hills #পাহাড় then #Land, #landscape #land। and #पहाड़!')
     <> ARRAY[normalize('পাহাড়', NFC), 'land', 'landscape', normalize('पहाड़', NFC)] THEN
    RAISE EXCEPTION 'PROBE FAIL P2: extract_hashtags gave %', public.extract_hashtags('Hills #পাহাড় then #Land, #landscape #land। and #पहाड़!');
  END IF;
  IF cardinality(public.extract_hashtags((SELECT string_agg('#t' || g, ' ') FROM generate_series(1, 40) g))) <> 30 THEN
    RAISE EXCEPTION 'PROBE FAIL P2: more than 30 tags kept';
  END IF;

  -- P3 · behaviour (staging only)
  IF current_setting('p32.lane', true) = 'staging' THEN
    SELECT p1.id, p2.id INTO _a, _b
      FROM public.profiles p1 JOIN auth.users u1 ON u1.id = p1.id
      CROSS JOIN public.profiles p2 JOIN auth.users u2 ON u2.id = p2.id
     WHERE p1.id <> p2.id AND NOT public.is_banned(p1.id) AND NOT public.is_banned(p2.id)
       AND NOT public.are_friends(p1.id, p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.profiles_public_data pp WHERE pp.id = p1.id AND (pp.is_banned OR pp.is_suspended))
     LIMIT 1;
    IF _b IS NULL THEN RAISE EXCEPTION 'PROBE FAIL P3: no two unrelated members on staging to test with'; END IF;

    INSERT INTO public.posts (user_id, content, privacy, image_urls) VALUES (_a, 'probe h1 public #probeh1 #' || _bn, 'public', ARRAY['https://example.invalid/probe-h1.jpg']) RETURNING id INTO _p1;
    INSERT INTO public.posts (user_id, content, privacy, image_urls) VALUES (_a, 'probe h1 friends #probeh1', 'friends', ARRAY['https://example.invalid/probe-h1.jpg']) RETURNING id INTO _p2;
    INSERT INTO public.posts (user_id, content, privacy, image_urls) VALUES (_a, 'probe h1 other #probeh1x', 'public', ARRAY['https://example.invalid/probe-h1.jpg']) RETURNING id INTO _p3;
    INSERT INTO public.posts (user_id, content, privacy, image_urls)
      VALUES (_a, (SELECT string_agg('#probe40t' || g, ' ') FROM generate_series(1, 40) g), 'public', ARRAY['https://example.invalid/probe-h1.jpg']) RETURNING id INTO _p4;

    SELECT count(*) INTO _n FROM public.post_hashtags WHERE post_id = _p4;
    IF _n <> 30 THEN RAISE EXCEPTION 'PROBE FAIL P3: the 40-tag post has % tag rows, want 30', _n; END IF;

    -- anon
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    PERFORM set_config('role', 'anon', true);
    SELECT count(*) INTO _n FROM public.hashtag_page_posts('probeh1', 'recent', NULL, 30);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P3: anon sees % posts on #probeh1, want 1', _n; END IF;
    SELECT count(*) INTO _n FROM public.hashtag_page_posts('#ProbeH1', 'top', NULL, 30);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P3: anon top on #ProbeH1 gives %, want 1', _n; END IF;
    SELECT count(*) INTO _n FROM public.hashtag_page_posts(_bn, 'recent', NULL, 30);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P3: anon sees % posts on the Bengali tag, want 1', _n; END IF;
    SELECT * INTO _info FROM public.hashtag_page_info('probeh1');
    IF _info.people_count <> 1 OR _info.post_count <> 1 OR _info.is_following THEN
      RAISE EXCEPTION 'PROBE FAIL P3: info % photographers · % posts · following %', _info.people_count, _info.post_count, _info.is_following;
    END IF;
    _ok := false;
    BEGIN
      PERFORM public.follow_hashtag('probeh1');
    EXCEPTION WHEN insufficient_privilege THEN _ok := true;
    END;
    IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL P3: anon could follow a hashtag'; END IF;

    -- B (not a friend)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO _n FROM public.hashtag_page_posts('probeh1', 'recent', NULL, 30);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P3: B sees % posts on #probeh1, want 1', _n; END IF;
    PERFORM public.follow_hashtag('probeh1');
    IF NOT (SELECT i.is_following FROM public.hashtag_page_info('probeh1') i) THEN
      RAISE EXCEPTION 'PROBE FAIL P3: B follows #probeh1 but is_following is false';
    END IF;
    PERFORM public.unfollow_hashtag('probeh1');
    IF (SELECT i.is_following FROM public.hashtag_page_info('probeh1') i) THEN
      RAISE EXCEPTION 'PROBE FAIL P3: B unfollowed #probeh1 but is_following is true';
    END IF;

    -- A (own friends-only post too) + paging
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO _n FROM public.hashtag_page_posts('probeh1', 'recent', NULL, 30);
    IF _n <> 2 THEN RAISE EXCEPTION 'PROBE FAIL P3: A sees % posts on #probeh1, want 2', _n; END IF;
    SELECT r.page_cursor INTO _cur FROM public.hashtag_page_posts('probeh1', 'recent', NULL, 1) r;
    SELECT count(*) INTO _n FROM public.hashtag_page_posts('probeh1', 'recent', _cur, 30) r
     WHERE (r.post->>'id')::uuid IN (_p1, _p2);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P3: recent page 2 after the cursor has % rows, want 1', _n; END IF;
    SELECT r.page_cursor INTO _cur FROM public.hashtag_page_posts('probeh1', 'top', NULL, 1) r;
    IF _cur IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'PROBE FAIL P3: top cursor is %, want 1', _cur; END IF;
    SELECT count(*) INTO _n FROM public.hashtag_page_posts('probeh1', 'top', _cur, 30);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P3: top page 2 has % rows, want 1', _n; END IF;

    PERFORM set_config('role', 'postgres', true);
    RAISE NOTICE 'P3 PASS: anon 1 · B 1 · A 2 · Bengali 1 · follow/unfollow · paging · 30-tag cap';
  ELSE
    RAISE NOTICE 'P3 skipped (production: no test writes)';
  END IF;

  -- P4 · counts
  RAISE NOTICE 'P4 hashtags % · post tags % · tags outside ASCII % · follows %',
    (SELECT count(*) FROM public.hashtags), (SELECT count(*) FROM public.post_hashtags),
    (SELECT count(*) FROM public.hashtags WHERE tag !~ '^[a-z0-9_]+$'), (SELECT count(*) FROM public.hashtag_follows);
  RAISE NOTICE 'PROBE H1-0100 PASS';
END
$p$;
ROLLBACK;
