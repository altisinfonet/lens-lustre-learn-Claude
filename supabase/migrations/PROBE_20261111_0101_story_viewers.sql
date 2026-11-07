-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261111_0101 story viewers + comment pages — ENDS IN ROLLBACK.
-- FAIL before 0101 (functions missing); PASS after. Prints COUNTS ONLY.
--
--   P1  structure: both functions exist, SECURITY DEFINER, authenticated may
--       call them, anon may not
--   P2  STAGING ONLY — as real members, inside this rolled-back transaction:
--       B sees A's story and likes it; A (owner) gets B in story_viewers with
--       liked = true; B asking for A's viewers is refused; 3 comments page
--       as 2 + 1 with the cursor, oldest → newest
--   P3  live counts: story views recorded
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE
  _n bigint; _a uuid; _b uuid; _s uuid; _ok boolean; _liked boolean; _t timestamptz;
BEGIN
  RAISE NOTICE 'PROBE 0101 lane % at %', coalesce(current_setting('p32.lane', true), '?'), now();

  -- P1 · structure
  IF to_regprocedure('public.story_viewers(uuid,integer,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.story_comments_page(uuid,integer,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P1: story_viewers / story_comments_page missing (expected before 0101 is applied)';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.story_viewers(uuid,integer,timestamp with time zone)'),
                   to_regprocedure('public.story_comments_page(uuid,integer,timestamp with time zone)'))
     AND p.prosecdef;
  IF _n <> 2 THEN RAISE EXCEPTION 'PROBE FAIL P1: % of 2 functions are SECURITY DEFINER', _n; END IF;
  IF has_function_privilege('anon', 'public.story_viewers(uuid,integer,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.story_comments_page(uuid,integer,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.story_viewers(uuid,integer,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.story_comments_page(uuid,integer,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: grants are not as intended';
  END IF;

  -- P2 · behaviour (staging only)
  IF current_setting('p32.lane', true) = 'staging' THEN
    SELECT p1.id, p2.id INTO _a, _b
      FROM public.profiles p1 JOIN auth.users u1 ON u1.id = p1.id
      CROSS JOIN public.profiles p2 JOIN auth.users u2 ON u2.id = p2.id
     WHERE p1.id <> p2.id AND NOT public.is_banned(p1.id) AND NOT public.is_banned(p2.id)
     LIMIT 1;
    IF _b IS NULL THEN RAISE EXCEPTION 'PROBE FAIL P2: no two members on staging to test with'; END IF;

    -- A's plain story (as A)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO public.stories (user_id, image_url) VALUES (_a, 'https://example.invalid/probe-0101.jpg') RETURNING id INTO _s;

    -- B sees it, likes it, comments 3 times
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO public.story_views (story_id, viewer_id) VALUES (_s, _b);
    INSERT INTO public.story_likes (story_id, user_id) VALUES (_s, _b);
    INSERT INTO public.story_comments (story_id, user_id, content, idempotency_key) VALUES (_s, _b, 'probe c1', 'probe-0101-1');
    INSERT INTO public.story_comments (story_id, user_id, content, idempotency_key) VALUES (_s, _b, 'probe c2', 'probe-0101-2');
    INSERT INTO public.story_comments (story_id, user_id, content, idempotency_key) VALUES (_s, _b, 'probe c3', 'probe-0101-3');
    -- spread the three comments in time so the cursor has an order to walk
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.story_comments SET created_at = now() - interval '3 minutes' WHERE story_id = _s AND content = 'probe c1';
    UPDATE public.story_comments SET created_at = now() - interval '2 minutes' WHERE story_id = _s AND content = 'probe c2';
    UPDATE public.story_comments SET created_at = now() - interval '1 minute'  WHERE story_id = _s AND content = 'probe c3';
    PERFORM set_config('role', 'authenticated', true);

    -- B may not read A's viewers
    _ok := false;
    BEGIN
      PERFORM * FROM public.story_viewers(_s);
    EXCEPTION WHEN insufficient_privilege THEN _ok := true;
    END;
    IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL P2: a non-owner read who saw the story'; END IF;

    -- comment pages (B can see the story): newest 2, then 1 older
    SELECT count(*), min(created_at) INTO _n, _t FROM public.story_comments_page(_s, 2, NULL);
    IF _n <> 2 THEN RAISE EXCEPTION 'PROBE FAIL P2: first page has % of 2 comments', _n; END IF;
    SELECT count(*) INTO _n FROM public.story_comments_page(_s, 2, _t);
    IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL P2: second page has % of 1 comment', _n; END IF;
    IF (SELECT content FROM public.story_comments_page(_s, 2, NULL) LIMIT 1) IS DISTINCT FROM 'probe c2' THEN
      RAISE EXCEPTION 'PROBE FAIL P2: a page is not drawn oldest → newest';
    END IF;

    -- A, the owner, sees B with the like
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*), bool_and(liked) INTO _n, _liked FROM public.story_viewers(_s) WHERE viewer_id = _b;
    IF _n <> 1 OR NOT _liked THEN RAISE EXCEPTION 'PROBE FAIL P2: the owner sees % viewer rows for B (liked: %)', _n, _liked; END IF;
    SELECT count(*) INTO _n FROM public.story_viewers(_s) WHERE viewer_id = _a;
    IF _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL P2: the owner is listed among their own viewers'; END IF;
    PERFORM set_config('role', 'postgres', true);
    RAISE NOTICE '  P2 behaviour: all checks passed (rolled back)';
  ELSE
    RAISE NOTICE '  P2 behaviour: skipped on this lane (runs on staging only)';
  END IF;

  -- P3 · counts
  SELECT count(*) INTO _n FROM public.story_views;
  RAISE NOTICE 'PROBE PASS 0101 (story views recorded: %)', _n;
END
$p$;
ROLLBACK;
