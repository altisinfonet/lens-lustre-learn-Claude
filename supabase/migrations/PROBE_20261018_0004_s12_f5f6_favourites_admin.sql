-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261018_0004 — S12-F5 + F6 Following / Favourites, admin mix
-- (staging and production). ONE transaction ending in ROLLBACK: every row it
-- writes (a follow, hides, mutes, favourites, an admin role, config edits,
-- audit rows) is gone afterwards. Raises, and so fails the dispatch, on any
-- hit. Run after 20261018_0004; FAILS before it (G1: objects missing).
--
--   G0 · lane guard: p32.lane must be staging or production.
--   G1 · static: the table (RLS on; one permissive INSERT / SELECT / DELETE
--        policy, no UPDATE; anon no SELECT), the five functions (exact
--        signatures, SECURITY DEFINER, search_path ''), EXECUTE: the four API
--        functions authenticated yes / anon no / PUBLIC no; feed_author_timeline
--        no API role; favourites_max = 50; the audit CHECK takes 'mix'.
--   CAST (all rolled back): viewer A (not an admin), author X (≥ 2 posts A may
--        see), author Y (≥ 1 post A may see, A does not follow Y). A is made to
--        follow X; A's hides, mutes and favourites are cleared.
--   G2 · FOLLOWING (as A, real JWT role): page 1 and page 2 (exclude = page 1)
--        equal an independent oracle (posts of the members A follows, not A's
--        own, today's visibility rule AND can_view_post, not hidden, not muted,
--        newest first); no row by Y; time order across both pages.
--   G3 · HIDE / MUTE: X's newest post hidden → never in Following; X muted →
--        no row by X.
--   G4 · FAVOURITES (as A): ★ Y (twice → one row); Favourites = the oracle over
--        {Y}, non-empty, no row by X; ★ self → refused (check_violation); a row
--        in X's name → refused (RLS); cap (favourites_max set to 1) → the next
--        ★ refused with FAVOURITES-001 while a re-send of Y still passes; A
--        cannot read X's favourites; removing ★ Y empties the tab.
--   G5 · ADMIN: A (not admin) → feed_mix_set and feed_mix_admin_stats refused
--        (insufficient_privilege). Admin B: sum 11 refused
--        (invalid_parameter_value); 5/3/2 saved, one 'mix' audit row by B; the
--        same values again → no new audit row; stats carry groups.with,
--        groups.without and mix.circle = 5.
--   G6 · anon: both feeds and feed_mix_set refused; no SELECT on the table.
--   G7 · NOTICE only: favourites rows on the lane; the mix.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Rows of _ids that _viewer may NOT see (today's feed rule AND can_view_post).
CREATE FUNCTION pg_temp.s12f56_not_visible(_viewer uuid, _ids uuid[])
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

-- The oracle: what a time-ordered feed of _authors must return for _viewer.
CREATE FUNCTION pg_temp.s12f56_expect(_viewer uuid, _authors uuid[], _exclude uuid[], _lim integer)
 RETURNS uuid[]
 LANGUAGE sql STABLE
AS $h$
  SELECT coalesce(array_agg(q.id ORDER BY q.created_at DESC, q.id DESC), '{}'::uuid[])
    FROM (
      SELECT p.id, p.created_at
        FROM public.posts p
       WHERE p.user_id = ANY (_authors)
         AND p.user_id <> _viewer
         AND NOT (p.id = ANY (coalesce(_exclude, '{}'::uuid[])))
         AND pg_temp.s12f56_not_visible(_viewer, ARRAY[p.id]) = 0
         AND NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts h WHERE h.user_id = _viewer AND h.post_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM public.feed_muted_authors m WHERE m.user_id = _viewer AND m.author_id = p.user_id)
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT _lim) q;
$h$;

DO $probe$
DECLARE
  _ff    constant text := 'public.get_following_feed(uuid[],integer,integer,text[],text)';
  _fv    constant text := 'public.get_favourites_feed(uuid[],integer,integer,text[],text)';
  _fs    constant text := 'public.feed_mix_set(integer,integer,integer)';
  _fa    constant text := 'public.feed_mix_admin_stats(integer)';
  _ft    constant text := 'public.feed_author_timeline(text,uuid[],integer,text[])';
  _bad   text := '';
  va     uuid;  vx uuid;  vy uuid;  vb uuid;
  hid    uuid;
  fol    uuid[];
  p1     uuid[]; p2 uuid[]; pg uuid[]; pf uuid[];
  au     uuid[];
  ts     timestamptz[];
  r      record;
  n      integer;
  failed boolean;
  _res   jsonb;
  _cnt0  bigint;
  _cnt1  bigint;
  _st    text;
BEGIN
  -- G0 · lane guard
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · static
  IF to_regclass('public.feed_favourite_authors') IS NULL OR to_regprocedure(_ff) IS NULL OR to_regprocedure(_fv) IS NULL
     OR to_regprocedure(_fs) IS NULL OR to_regprocedure(_fa) IS NULL OR to_regprocedure(_ft) IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL G1: 20261018_0004 objects missing (not applied)';
  END IF;
  FOR r IN SELECT unnest(ARRAY[_ff, _fv, _fs, _fa, _ft, 'public.feed_favourite_authors_before()']) AS f LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) THEN
      _bad := _bad || E'\n  G1 ' || r.f || ' not SECURITY DEFINER with search_path ''''';
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY[_ff, _fv, _fs, _fa]) AS f LOOP
    IF NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN _bad := _bad || E'\n  G1 authenticated cannot execute ' || r.f; END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ac
                   WHERE p.oid = r.f::regprocedure AND ac.grantee = 0 AND ac.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  G1 anon or PUBLIC can execute ' || r.f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', _ft, 'EXECUTE') OR has_function_privilege('anon', _ft, 'EXECUTE') THEN
    _bad := _bad || E'\n  G1 feed_author_timeline is executable by an API role';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.feed_favourite_authors'::regclass) THEN
    _bad := _bad || E'\n  G1 RLS off on feed_favourite_authors';
  END IF;
  IF (SELECT string_agg(cmd, ',' ORDER BY cmd) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'feed_favourite_authors' AND permissive = 'PERMISSIVE') IS DISTINCT FROM 'DELETE,INSERT,SELECT' THEN
    _bad := _bad || E'\n  G1 policies are not one permissive DELETE / INSERT / SELECT';
  END IF;
  IF has_table_privilege('anon', 'public.feed_favourite_authors', 'SELECT') THEN _bad := _bad || E'\n  G1 anon can read favourites'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feed_score_config WHERE key = 'favourites_max' AND value = 50) THEN
    _bad := _bad || E'\n  G1 favourites_max is not 50';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.feature_access_audit'::regclass
                             AND conname = 'feature_access_audit_action_check')) NOT LIKE '%''mix''%' THEN
    _bad := _bad || E'\n  G1 the audit CHECK does not take ''mix''';
  END IF;

  -- CAST (owner, nothing survives the ROLLBACK)
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  FOR r IN SELECT pr.id FROM public.profiles pr
            WHERE NOT public.has_role(pr.id, 'admin'::public.app_role)
              AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pr.id)
            ORDER BY pr.id LOOP
    va := r.id;
    SELECT p.user_id INTO vx FROM public.posts p
     WHERE p.user_id <> va AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id)
       AND pg_temp.s12f56_not_visible(va, ARRAY[p.id]) = 0
     GROUP BY p.user_id HAVING count(*) >= 2 ORDER BY count(*) DESC, p.user_id LIMIT 1;
    SELECT p.user_id INTO vy FROM public.posts p
     WHERE p.user_id <> va AND p.user_id IS DISTINCT FROM vx
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id)
       AND NOT EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = va AND f.following_id = p.user_id)
       AND pg_temp.s12f56_not_visible(va, ARRAY[p.id]) = 0
     GROUP BY p.user_id ORDER BY count(*) DESC, p.user_id LIMIT 1;
    EXIT WHEN vx IS NOT NULL AND vy IS NOT NULL;
    vx := NULL; vy := NULL;
  END LOOP;
  IF vx IS NULL OR vy IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL CAST: no viewer with an author of 2+ visible posts and an unfollowed author of 1+ visible post';
  END IF;
  SELECT pr.id INTO vb FROM public.profiles pr
   WHERE pr.id NOT IN (va, vx, vy) AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pr.id)
   ORDER BY public.has_role(pr.id, 'admin'::public.app_role) DESC, pr.id LIMIT 1;
  IF vb IS NULL THEN RAISE EXCEPTION 'PROBE FAIL CAST: no fourth member for the admin gates'; END IF;
  IF NOT public.has_role(vb, 'admin'::public.app_role) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (vb, 'admin');
  END IF;

  INSERT INTO public.follows (follower_id, following_id)
  SELECT va, vx WHERE NOT EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = va AND f.following_id = vx);
  DELETE FROM public.feed_hidden_posts WHERE user_id = va;
  DELETE FROM public.feed_muted_authors WHERE user_id = va;
  DELETE FROM public.feed_favourite_authors WHERE user_id = va;
  SELECT array_agg(f.following_id) INTO fol FROM public.follows f WHERE f.follower_id = va;

  -- G2 · FOLLOWING (as A)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', va, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', va::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(array_agg(g.id ORDER BY o), '{}') INTO p1
    FROM public.get_following_feed(NULL, 10, 3, NULL, 'probe') WITH ORDINALITY AS g(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count, shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  SELECT coalesce(array_agg(g.id ORDER BY o), '{}') INTO p2
    FROM public.get_following_feed(p1, 10, 0, NULL, 'probe') WITH ORDINALITY AS g(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count, shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  RESET ROLE;
  IF cardinality(p1) = 0 THEN _bad := _bad || E'\n  G2 Following page 1 is empty although A follows X'; END IF;
  IF p1 IS DISTINCT FROM pg_temp.s12f56_expect(va, fol, NULL, 10) THEN _bad := _bad || E'\n  G2 Following page 1 differs from the oracle'; END IF;
  IF p2 IS DISTINCT FROM pg_temp.s12f56_expect(va, fol, p1, 10) THEN _bad := _bad || E'\n  G2 Following page 2 differs from the oracle'; END IF;
  IF EXISTS (SELECT 1 FROM public.posts p WHERE p.id = ANY (p1 || p2) AND p.user_id = vy) THEN
    _bad := _bad || E'\n  G2 Following returned a post by an author A does not follow';
  END IF;
  IF pg_temp.s12f56_not_visible(va, p1 || p2) > 0 THEN _bad := _bad || E'\n  G2 Following returned a post A may not see'; END IF;
  SELECT array_agg(p.created_at ORDER BY x.o) INTO ts FROM unnest(p1 || p2) WITH ORDINALITY x(pid, o) JOIN public.posts p ON p.id = x.pid;
  IF EXISTS (SELECT 1 FROM generate_subscripts(ts, 1) i WHERE i > 1 AND ts[i] > ts[i - 1]) THEN
    _bad := _bad || E'\n  G2 Following is not newest first across pages';
  END IF;

  -- G3 · HIDE / MUTE
  SELECT q[1] INTO hid FROM (SELECT pg_temp.s12f56_expect(va, ARRAY[vx], NULL, 1) AS q) z;
  INSERT INTO public.feed_hidden_posts (user_id, post_id, reason) VALUES (va, hid, 'not_interested');
  SET LOCAL ROLE authenticated;
  SELECT coalesce(array_agg(g.id), '{}') INTO pg FROM public.get_following_feed(NULL, 50, 0, NULL, NULL) g;
  RESET ROLE;
  IF hid = ANY (pg) THEN _bad := _bad || E'\n  G3 a hidden post is in Following'; END IF;
  INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (va, vx);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(array_agg(g.user_id), '{}') INTO au FROM public.get_following_feed(NULL, 50, 0, NULL, NULL) g;
  RESET ROLE;
  IF vx = ANY (au) THEN _bad := _bad || E'\n  G3 a muted author is in Following'; END IF;
  DELETE FROM public.feed_muted_authors WHERE user_id = va;
  DELETE FROM public.feed_hidden_posts WHERE user_id = va;

  -- G4 · FAVOURITES (as A)
  SET LOCAL ROLE authenticated;
  INSERT INTO public.feed_favourite_authors (user_id, author_id) VALUES (va, vy);
  INSERT INTO public.feed_favourite_authors (user_id, author_id) VALUES (va, vy) ON CONFLICT (user_id, author_id) DO NOTHING;
  SELECT count(*) INTO n FROM public.feed_favourite_authors WHERE user_id = va;
  IF n <> 1 THEN _bad := _bad || E'\n  G4 ★ twice did not leave exactly one row (' || n || ')'; END IF;
  SELECT coalesce(array_agg(g.id ORDER BY o), '{}') INTO pf
    FROM public.get_favourites_feed(NULL, 10, 0, NULL, NULL) WITH ORDINALITY AS g(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count, shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  failed := false;
  BEGIN
    INSERT INTO public.feed_favourite_authors (user_id, author_id) VALUES (va, va);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G4 ★ self was accepted'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.feed_favourite_authors (user_id, author_id) VALUES (vx, vy);
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G4 a favourite in another member''s name was accepted'; END IF;
  RESET ROLE;
  IF cardinality(pf) = 0 THEN _bad := _bad || E'\n  G4 Favourites is empty although A starred Y'; END IF;
  IF pf IS DISTINCT FROM pg_temp.s12f56_expect(va, ARRAY[vy], NULL, 10) THEN _bad := _bad || E'\n  G4 Favourites differs from the oracle'; END IF;
  IF EXISTS (SELECT 1 FROM public.posts p WHERE p.id = ANY (pf) AND p.user_id <> vy) THEN
    _bad := _bad || E'\n  G4 Favourites returned a post by a member A did not star';
  END IF;
  -- cap
  UPDATE public.feed_score_config SET value = 1 WHERE key = 'favourites_max';
  INSERT INTO public.feed_favourite_authors (user_id, author_id) VALUES (vx, vy);   -- X's own row (owner), for the read test
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN
    INSERT INTO public.feed_favourite_authors (user_id, author_id) VALUES (va, vx);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS _st = MESSAGE_TEXT;
    failed := _st LIKE 'FAVOURITES-001%';
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G4 a favourite past favourites_max was accepted'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.feed_favourite_authors (user_id, author_id) VALUES (va, vy) ON CONFLICT (user_id, author_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN failed := true;
  END;
  IF failed THEN _bad := _bad || E'\n  G4 a re-send of an existing favourite was refused at the cap'; END IF;
  SELECT count(*) INTO n FROM public.feed_favourite_authors WHERE user_id = vx;
  IF n <> 0 THEN _bad := _bad || E'\n  G4 A can read another member''s favourites'; END IF;
  DELETE FROM public.feed_favourite_authors WHERE user_id = va AND author_id = vy;
  SELECT count(*) INTO n FROM public.get_favourites_feed(NULL, 10, 0, NULL, NULL);
  IF n <> 0 THEN _bad := _bad || E'\n  G4 Favourites is not empty after removing the only ★'; END IF;

  -- G5 · ADMIN — A is not an admin
  failed := false;
  BEGIN PERFORM public.feed_mix_set(6, 2, 2); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G5 a non-admin changed the mix'; END IF;
  failed := false;
  BEGIN PERFORM public.feed_mix_admin_stats(7); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G5 a non-admin read the feed numbers'; END IF;
  RESET ROLE;
  SELECT count(*) INTO _cnt0 FROM public.feature_access_audit WHERE feature = 'personal_feed' AND action = 'mix';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', vb, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', vb::text, true);
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN PERFORM public.feed_mix_set(5, 3, 3); EXCEPTION WHEN invalid_parameter_value THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G5 a mix that does not add up to 10 was accepted'; END IF;
  _res := public.feed_mix_set(5, 3, 2);          -- 'changed' is false only if the lane already stood at 5 / 3 / 2
  _res := public.feed_mix_set(5, 3, 2);
  IF (_res ->> 'changed')::boolean THEN _bad := _bad || E'\n  G5 saving the same mix twice changed it twice'; END IF;
  _res := public.feed_mix_admin_stats(7);
  RESET ROLE;
  IF (SELECT value FROM public.feed_score_config WHERE key = 'mix_circle') <> 5
     OR (SELECT value FROM public.feed_score_config WHERE key = 'mix_suggested') <> 3
     OR (SELECT value FROM public.feed_score_config WHERE key = 'mix_fair') <> 2 THEN
    _bad := _bad || E'\n  G5 the saved mix is not 5 / 3 / 2';
  END IF;
  SELECT count(*) INTO _cnt1 FROM public.feature_access_audit WHERE feature = 'personal_feed' AND action = 'mix';
  -- exactly one new row unless the lane already stood at 5 / 3 / 2
  IF _cnt1 - _cnt0 > 1 THEN _bad := _bad || E'\n  G5 more than one audit row for one change'; END IF;
  IF _cnt1 - _cnt0 = 1 AND NOT EXISTS (SELECT 1 FROM public.feature_access_audit
                                        WHERE feature = 'personal_feed' AND action = 'mix' AND actor = vb
                                          AND new_value = 'circle 5 / suggested 3 / fair 2') THEN
    _bad := _bad || E'\n  G5 the audit row does not name the admin and the new mix';
  END IF;
  IF _res -> 'groups' -> 'with' IS NULL OR _res -> 'groups' -> 'without' IS NULL
     OR (_res -> 'mix' ->> 'circle')::numeric <> 5 THEN
    _bad := _bad || E'\n  G5 feed_mix_admin_stats lacks groups.with / groups.without / mix';
  END IF;

  -- G6 · anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  failed := false;
  BEGIN PERFORM * FROM public.get_following_feed(NULL, 10, 0, NULL, NULL); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G6 anon executed get_following_feed'; END IF;
  failed := false;
  BEGIN PERFORM * FROM public.get_favourites_feed(NULL, 10, 0, NULL, NULL); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G6 anon executed get_favourites_feed'; END IF;
  failed := false;
  BEGIN PERFORM public.feed_mix_set(6, 2, 2); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G6 anon executed feed_mix_set'; END IF;
  failed := false;
  BEGIN PERFORM 1 FROM public.feed_favourite_authors LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN _bad := _bad || E'\n  G6 anon read feed_favourite_authors'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0004:%', _bad;
  END IF;

  -- G7 · NOTICE only
  RAISE NOTICE 'PROBE PASS 20261018_0004 — G1–G6 green. Lane favourites rows (before this probe''s): %; following page 1: % rows; favourites: % rows',
    (SELECT count(*) FROM public.feed_favourite_authors), cardinality(p1), cardinality(pf);
END
$probe$;

ROLLBACK;
