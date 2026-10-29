-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261029_0500 — S6-a Feed paging by cursor (staging and production)
-- Writes test rows INSIDE its own transaction and ends in ROLLBACK: nothing it
-- does survives (follows, delivery-log rows). Raises, and so fails the
-- dispatch, on any hit. Run after 20261029_0500; FAILS before it (G1:
-- get_feed_page does not exist).
--
-- The fixture is the lane's own posts, read as real members (real JWT role
-- `authenticated`), all inside one transaction: now() is fixed and nothing
-- records a view, so the OLD call is deterministic for a given seed and the
-- two ways of paging can be compared row for row.
--
--   G0 · lane guard: p32.lane must be staging or production.
--   G1 · static: get_feed_page(text,boolean,text,integer,integer,integer,text[])
--        exists, SECURITY DEFINER, search_path ''; EXECUTE: authenticated yes,
--        anon / service_role / PUBLIC no; feed_session_delivered has RLS on and
--        anon / authenticated hold no privilege on it.
--   G2 · BROADCAST = OLD ORDER: as member A, 10 pages of get_feed_page
--        ('for_you', false) with `_after` only are EXACTLY the 10 pages of
--        get_broadcast_feed(5-arg) fed the growing _exclude_ids — same ids,
--        same order, no duplicate, no gap.
--   G3 · PERSONAL = OLD ORDER: the same for get_personal_feed (_personal true).
--   G4 · RETRY: page 3 asked again with the same cursor (after pages 3–10 were
--        dealt) returns page 3 again; page 4 after it returns page 4 again.
--        FALLBACK: a personal page then a broadcast page in ONE session never
--        repeat a post (one log per session). DRIFT: a cursor ahead of the
--        log is refused (22023), never dealt from a short list.
--   G5 · FOLLOWING = OLD ORDER: A follows three authors (rolled back); 5 pages
--        of get_feed_page('following') = get_following_feed with _exclude_ids.
--   G6 · PRIVACY (member B, real JWT role): B follows the author of a
--        friends-only post who is NOT B's friend and the author of a private
--        post; 3 personal + 3 broadcast cursor pages contain no row B may not
--        view (today's feed rule AND can_view_post). B paging with A's seed
--        leaves A's delivery log untouched.
--   G7 · anon cannot execute get_feed_page; authenticated cannot read the log
--        directly.
--   G8 · a blank _session_seed is refused (22023), never a silent new deal.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Rows of _ids that _viewer may NOT see (today's feed rule AND can_view_post).
CREATE FUNCTION pg_temp.s6a_not_visible(_viewer uuid, _ids uuid[])
 RETURNS integer
 LANGUAGE sql STABLE
AS $h$
  SELECT count(*)::integer
    FROM unnest(_ids) x(pid) JOIN public.posts p ON p.id = x.pid
   WHERE NOT (
           (   p.is_public OR p.user_id = _viewer
            OR (p.privacy = 'friends' AND EXISTS (
                  SELECT 1 FROM public.friendships f
                   WHERE f.status = 'accepted'
                     AND ((f.requester_id = _viewer AND f.addressee_id = p.user_id)
                       OR (f.addressee_id = _viewer AND f.requester_id = p.user_id)))))
           AND public.can_view_post(_viewer, p.user_id, p.privacy));
$h$;

DO $probe$
DECLARE
  _f      constant text := 'public.get_feed_page(text,boolean,text,integer,integer,integer,text[])';
  _bad    text := '';
  a       uuid;  b uuid;
  old_ids uuid[]; new_ids uuid[]; pg_ids uuid[]; pg2 uuid[];
  aft     integer;
  n       integer; n2 integer;
  i       integer;
  failed  boolean;
  nb      integer; np integer; nf integer; allb integer := 0;
BEGIN
  -- G0 · lane guard
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · static
  IF to_regprocedure(_f) IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261029_0500:% ', E'\n  G1 get_feed_page does not exist (20261029_0500 not applied)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = _f::regprocedure AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) THEN
    _bad := _bad || E'\n  G1 get_feed_page is not SECURITY DEFINER with search_path ''''';
  END IF;
  IF NOT has_function_privilege('authenticated', _f, 'EXECUTE')
     OR has_function_privilege('anon', _f, 'EXECUTE') OR has_function_privilege('service_role', _f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = _f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    _bad := _bad || E'\n  G1 get_feed_page EXECUTE is not authenticated-only';
  END IF;
  IF to_regclass('public.feed_session_delivered') IS NULL
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.feed_session_delivered'::regclass)
     OR has_table_privilege('anon', 'public.feed_session_delivered', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.feed_session_delivered', 'SELECT,INSERT,UPDATE,DELETE') THEN
    _bad := _bad || E'\n  G1 feed_session_delivered missing, RLS off, or readable/writable by anon/authenticated';
  END IF;
  IF _bad <> '' THEN RAISE EXCEPTION 'PROBE FAIL 20261029_0500:%', _bad; END IF;

  -- CAST: A = the account with the most connections (a real circle); B = another account.
  SELECT u.id INTO a FROM auth.users u
   ORDER BY (SELECT count(*) FROM public.follows f WHERE f.follower_id = u.id)
          + (SELECT count(*) FROM public.friendships f WHERE f.status = 'accepted' AND (f.requester_id = u.id OR f.addressee_id = u.id)) DESC, u.id
   LIMIT 1;
  SELECT u.id INTO b FROM auth.users u WHERE u.id <> a ORDER BY u.id LIMIT 1;
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'PROBE CAST: needs two accounts on this lane'; END IF;
  -- A follows the three authors with the most public posts (for G5).
  INSERT INTO public.follows (follower_id, following_id)
  SELECT a, q.user_id FROM (
    SELECT po.user_id FROM public.posts po
     WHERE po.is_public AND po.user_id <> a AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = po.user_id)
     GROUP BY po.user_id ORDER BY count(*) DESC, po.user_id LIMIT 3) q
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;

  -- G2 · broadcast: old pages vs cursor pages
  old_ids := '{}';
  FOR i IN 1..10 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO pg_ids
      FROM public.get_broadcast_feed(old_ids, 10, CASE WHEN i = 1 THEN 3 ELSE 0 END, NULL, 'probe-s6a-b')
           WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                                shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, o);
    EXIT WHEN cardinality(pg_ids) = 0;
    old_ids := old_ids || pg_ids;
  END LOOP;
  new_ids := '{}'; aft := 0;
  FOR i IN 1..10 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}'), coalesce(max(f.feed_pos), aft) INTO pg_ids, aft
      FROM public.get_feed_page('for_you', false, 'probe-s6a-b', aft, 10, CASE WHEN i = 1 THEN 3 ELSE 0 END, NULL) f;
    EXIT WHEN cardinality(pg_ids) = 0;
    new_ids := new_ids || pg_ids;
  END LOOP;
  nb := cardinality(new_ids);
  IF nb < 20 THEN _bad := _bad || format(E'\n  G2 only %s broadcast rows over 10 pages (cannot judge)', nb); END IF;
  IF old_ids IS DISTINCT FROM new_ids THEN
    _bad := _bad || format(E'\n  G2 broadcast cursor pages differ from the _exclude_ids pages (old %s rows, new %s rows)', cardinality(old_ids), nb);
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(new_ids) x) <> nb THEN _bad := _bad || E'\n  G2 broadcast cursor pages repeat a post'; END IF;
  IF aft <> nb THEN _bad := _bad || format(E'\n  G2 the last feed_pos (%s) is not the number of rows dealt (%s)', aft, nb); END IF;

  -- G3 · personal: old pages vs cursor pages
  old_ids := '{}';
  FOR i IN 1..10 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO pg_ids
      FROM public.get_personal_feed(old_ids, 10, CASE WHEN i = 1 THEN 3 ELSE 0 END, NULL, 'probe-s6a-p')
           WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                                shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
    EXIT WHEN cardinality(pg_ids) = 0;
    old_ids := old_ids || pg_ids;
  END LOOP;
  new_ids := '{}'; aft := 0;
  FOR i IN 1..10 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}'), coalesce(max(f.feed_pos), aft) INTO pg_ids, aft
      FROM public.get_feed_page('for_you', true, 'probe-s6a-p', aft, 10, CASE WHEN i = 1 THEN 3 ELSE 0 END, NULL) f;
    EXIT WHEN cardinality(pg_ids) = 0;
    new_ids := new_ids || pg_ids;
  END LOOP;
  np := cardinality(new_ids);
  IF np < 20 THEN _bad := _bad || format(E'\n  G3 only %s personal rows over 10 pages (cannot judge)', np); END IF;
  IF old_ids IS DISTINCT FROM new_ids THEN
    _bad := _bad || format(E'\n  G3 personal cursor pages differ from the _exclude_ids pages (old %s rows, new %s rows)', cardinality(old_ids), np);
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(new_ids) x) <> np THEN _bad := _bad || E'\n  G3 personal cursor pages repeat a post'; END IF;

  -- G4 · retry of page 3, then page 4, against the pages dealt in G3
  IF np >= 40 THEN
    SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}') INTO pg_ids
      FROM public.get_feed_page('for_you', true, 'probe-s6a-p', 20, 10, 0, NULL) f;
    IF pg_ids IS DISTINCT FROM new_ids[21:30] THEN _bad := _bad || E'\n  G4 page 3 asked again is not page 3'; END IF;
    SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}') INTO pg_ids
      FROM public.get_feed_page('for_you', true, 'probe-s6a-p', 30, 10, 0, NULL) f;
    IF pg_ids IS DISTINCT FROM new_ids[31:40] THEN _bad := _bad || E'\n  G4 page 4 after the retry is not page 4'; END IF;
  ELSE
    _bad := _bad || format(E'\n  G4 needs 40 personal rows (got %s)', np);
  END IF;
  -- drift guard: a cursor ahead of the log is refused, never served from a short list
  BEGIN
    PERFORM count(*) FROM public.get_feed_page('for_you', true, 'probe-s6a-p', np + 10, 10, 0, NULL);
    _bad := _bad || E'\n  G4 a cursor ahead of the session log was served';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- fallback inside one session: personal page 1, broadcast page 2
  SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}') INTO pg_ids
    FROM public.get_feed_page('for_you', true, 'probe-s6a-m', 0, 10, 3, NULL) f;
  SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}') INTO pg2
    FROM public.get_feed_page('for_you', false, 'probe-s6a-m', cardinality(pg_ids), 10, 0, NULL) f;
  IF pg_ids && pg2 THEN _bad := _bad || E'\n  G4 a broadcast page after a personal page in one session repeated a post'; END IF;

  -- G5 · following tab: old pages vs cursor pages
  old_ids := '{}';
  FOR i IN 1..5 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO pg_ids
      FROM public.get_following_feed(old_ids, 10, 0, NULL, NULL)
           WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                                shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
    EXIT WHEN cardinality(pg_ids) = 0;
    old_ids := old_ids || pg_ids;
  END LOOP;
  new_ids := '{}'; aft := 0;
  FOR i IN 1..5 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}'), coalesce(max(f.feed_pos), aft) INTO pg_ids, aft
      FROM public.get_feed_page('following', false, 'probe-s6a-f', aft, 10, 0, NULL) f;
    EXIT WHEN cardinality(pg_ids) = 0;
    new_ids := new_ids || pg_ids;
  END LOOP;
  nf := cardinality(new_ids);
  IF nf < 10 THEN _bad := _bad || format(E'\n  G5 only %s following rows (cannot judge)', nf); END IF;
  IF old_ids IS DISTINCT FROM new_ids THEN _bad := _bad || E'\n  G5 following cursor pages differ from the _exclude_ids pages'; END IF;
  RESET ROLE;

  -- G6 · privacy, member B
  SELECT count(*) INTO n FROM public.feed_session_delivered d WHERE d.viewer = a;
  INSERT INTO public.follows (follower_id, following_id)
  SELECT b, q.user_id FROM (
    (SELECT po.user_id FROM public.posts po
      WHERE po.privacy = 'friends' AND po.user_id <> b
        AND NOT EXISTS (SELECT 1 FROM public.friendships f WHERE f.status = 'accepted'
              AND ((f.requester_id = b AND f.addressee_id = po.user_id) OR (f.addressee_id = b AND f.requester_id = po.user_id)))
      ORDER BY po.created_at DESC LIMIT 1)
    UNION
    (SELECT po.user_id FROM public.posts po WHERE po.privacy = 'private' AND po.user_id <> b ORDER BY po.created_at DESC LIMIT 1)
  ) q
  ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  aft := 0;
  FOR i IN 1..3 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}'), coalesce(max(f.feed_pos), aft) INTO pg_ids, aft
      FROM public.get_feed_page('for_you', true, 'probe-s6a-p', aft, 10, CASE WHEN i = 1 THEN 3 ELSE 0 END, NULL) f;
    RESET ROLE;
    allb := allb + cardinality(pg_ids);
    n2 := pg_temp.s6a_not_visible(b, pg_ids);
    IF n2 > 0 THEN _bad := _bad || format(E'\n  G6 member B received %s personal post(s) B may not view', n2); END IF;
    SET LOCAL ROLE authenticated;
  END LOOP;
  aft := 0;
  FOR i IN 1..3 LOOP
    SELECT coalesce(array_agg(f.id ORDER BY f.feed_pos), '{}'), coalesce(max(f.feed_pos), aft) INTO pg_ids, aft
      FROM public.get_feed_page('for_you', false, 'probe-s6a-b', aft, 10, CASE WHEN i = 1 THEN 3 ELSE 0 END, NULL) f;
    RESET ROLE;
    allb := allb + cardinality(pg_ids);
    n2 := pg_temp.s6a_not_visible(b, pg_ids);
    IF n2 > 0 THEN _bad := _bad || format(E'\n  G6 member B received %s broadcast post(s) B may not view', n2); END IF;
    SET LOCAL ROLE authenticated;
  END LOOP;
  RESET ROLE;
  IF allb = 0 THEN _bad := _bad || E'\n  G6 member B received nothing (cannot judge privacy)'; END IF;
  IF (SELECT count(*) FROM public.feed_session_delivered d WHERE d.viewer = a) <> n THEN
    _bad := _bad || E'\n  G6 member B paging with A''s seeds changed A''s delivery log';
  END IF;

  -- G7 · anon refused; authenticated cannot read the log
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  failed := false;
  BEGIN
    PERFORM count(*) FROM public.get_feed_page('for_you', false, 'probe-anon', 0, 10, 3, NULL);
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  RESET ROLE;
  IF NOT failed THEN _bad := _bad || E'\n  G7 anon could execute get_feed_page'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN
    PERFORM count(*) FROM public.feed_session_delivered;
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  -- G8 · blank seed
  BEGIN
    PERFORM count(*) FROM public.get_feed_page('for_you', false, '  ', 0, 10, 3, NULL);
    _bad := _bad || E'\n  G8 a blank _session_seed was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  RESET ROLE;
  IF NOT failed THEN _bad := _bad || E'\n  G7 authenticated could read feed_session_delivered directly'; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261029_0500:%', _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261029_0500 (lane %): definer + search_path '''' + authenticated only; log RLS on, no API access; cursor pages = _exclude_ids pages row for row (broadcast % rows, personal % rows, following % rows), no repeats; retry re-deals the same page; personal→broadcast fallback never repeats; B saw % rows, 0 not viewable, A''s log untouched; anon refused; blank seed refused',
    current_setting('p32.lane'), nb, np, nf, allb;
END
$probe$;
ROLLBACK;
