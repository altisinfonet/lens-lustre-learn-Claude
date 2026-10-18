-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261018_0003 — S12-F3 + F4 Personal feed (staging and production)
-- Writes test rows INSIDE its own transaction and ends in ROLLBACK: nothing it
-- does survives (follows, mute, hide, test categories, test quality rows,
-- config edits). Raises, and so fails the dispatch, on any hit. Run after
-- 20261018_0003; FAILS before it (G1: get_personal_feed does not exist).
--
--   G0 · lane guard: p32.lane must be staging or production.
--   G1 · static: get_personal_feed(uuid[],integer,integer,text[],text) exists,
--        SECURITY DEFINER, search_path ''; EXECUTE: authenticated yes, anon no,
--        PUBLIC no; the 14 mix / rank keys exist; the personal_feed switch exists.
--   CAST (all rolled back): authors X1, X2 (most public posts), M; viewer A
--        (fewest connections, no post in the last 24 h) follows X1, X2 and M,
--        mutes M, hides X1's newest post; six recent public posts by authors
--        outside A's circle get the test category 's12f34-s' and A gets a
--        decayed interest of 50 in it.
--   G2 · RATIO + VARIETY + EXCLUSIONS (as A, real JWT role): pages 1 and 2 are
--        exactly circle 6 / suggested 2 / fair 2; across pages 1–3 no post
--        twice, never the hidden post, never M, never 3 in a row by one author,
--        never 4 in a row sharing a category; every row passes today's
--        visibility rule and can_view_post.
--   G3 · SEEDS: page 1 again with the same seed = the same order; with another
--        seed = a different order.
--   G4 · CAUGHT UP: every circle post except the two newest unseen ones is
--        passed as already delivered → exactly one row carries caught_up_after,
--        it is the second of the two circle rows, and the rest of the page is
--        filled from suggested / fair (adaptive).
--   G5 · CATEGORY RULE UNDER PRESSURE: mix set to circle-only and twelve circle
--        posts given one category → still never 4 in a row sharing it, never 3
--        in a row by one author.
--   G6 · COLD START: a member with fewer than cold_history_min score rows gets
--        a non-empty page with at least one 'suggested' (popular) row.
--   G7 · PRIVACY (member B, real JWT role): B follows the author of a
--        friends-only post who is NOT B's friend, and the author of a private
--        post; across three pages B never receives a row B may not view.
--   G8 · anon cannot execute get_personal_feed (refused: no privilege).
--   G9 · NOTICE only: posts created in the last 24 h; the switch's mode and
--        list size.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Owner-only helpers (temporary, gone at ROLLBACK): longest run of one author /
-- one shared category in a delivery-ordered id list.
CREATE FUNCTION pg_temp.s12f34_runs(_ids uuid[], OUT author_run integer, OUT cat_run integer)
 LANGUAGE sql STABLE
AS $h$
  WITH u AS (
    SELECT x.o, p.user_id, p.categories
      FROM unnest(_ids) WITH ORDINALITY AS x(pid, o) JOIN public.posts p ON p.id = x.pid
  ),
  a AS (SELECT user_id, o - row_number() OVER (PARTITION BY user_id ORDER BY o) AS g FROM u),
  c AS (SELECT cc, o - row_number() OVER (PARTITION BY cc ORDER BY o) AS g FROM u CROSS JOIN LATERAL unnest(u.categories) cc)
  SELECT coalesce((SELECT max(n) FROM (SELECT count(*) AS n FROM a GROUP BY user_id, g) z), 0)::integer,
         coalesce((SELECT max(n) FROM (SELECT count(*) AS n FROM c GROUP BY cc, g) z), 0)::integer;
$h$;

-- Rows of _ids that _viewer may NOT see (today's feed rule AND can_view_post).
CREATE FUNCTION pg_temp.s12f34_not_visible(_viewer uuid, _ids uuid[])
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
  _f     constant text := 'public.get_personal_feed(uuid[],integer,integer,text[],text)';
  _bad   text := '';
  x1     uuid;  x2 uuid;  m uuid;  a uuid;  b uuid;  c0 uuid;  hid uuid;
  sugg   uuid[];
  ids1   uuid[]; src1 text[]; cu1 boolean[];
  ids1b  uuid[]; ids1c uuid[];
  ids2   uuid[]; src2 text[];
  ids3   uuid[];
  idsg   uuid[]; srcg text[]; cug boolean[];
  idsp   uuid[];
  idsc   uuid[]; srcc text[];
  idsb   uuid[]; allb uuid[] := '{}';
  circle uuid[];
  keep   uuid[];
  ex     uuid[];
  r      record;
  n      integer;
  i      integer;
  failed boolean;
  _mode  text;
  _h     bigint;
BEGIN
  -- G0 · lane guard
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · static
  IF to_regprocedure(_f) IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL G1: % does not exist (20261018_0003 not applied)', _f;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = _f::regprocedure AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) THEN
    _bad := _bad || E'\n  G1 get_personal_feed is not SECURITY DEFINER with search_path ''''';
  END IF;
  IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN _bad := _bad || E'\n  G1 authenticated cannot execute'; END IF;
  IF has_function_privilege('anon', _f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ac
                 WHERE p.oid = _f::regprocedure AND ac.grantee = 0 AND ac.privilege_type = 'EXECUTE') THEN
    _bad := _bad || E'\n  G1 anon or PUBLIC can execute';
  END IF;
  IF (SELECT count(*) FROM public.feed_score_config WHERE key IN (
        'mix_circle', 'mix_suggested', 'mix_fair', 'rank_w_closeness', 'rank_w_category', 'rank_w_chosen',
        'rank_w_quality', 'rank_quality_norm', 'rank_w_freshness', 'rank_fresh_hours', 'rank_w_seen',
        'rank_seen_hours', 'rank_w_jitter', 'cold_history_min')) <> 14 THEN
    _bad := _bad || E'\n  G1 mix/rank keys missing from feed_score_config';
  END IF;
  SELECT mode INTO _mode FROM public.feature_access WHERE feature = 'personal_feed';
  IF _mode IS NULL THEN _bad := _bad || E'\n  G1 the personal_feed switch is missing'; END IF;
  IF _bad <> '' THEN RAISE EXCEPTION 'PROBE FAIL 20261018_0003:%', _bad; END IF;

  -- The ratio is checked against the seeded 6 / 2 / 2 (an admin may have tuned it).
  UPDATE public.feed_score_config SET value = 6 WHERE key = 'mix_circle';
  UPDATE public.feed_score_config SET value = 2 WHERE key IN ('mix_suggested', 'mix_fair');

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- CAST
  SELECT po.user_id INTO x1 FROM public.posts po
   WHERE po.is_public AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = po.user_id)
   GROUP BY po.user_id ORDER BY count(*) DESC, po.user_id LIMIT 1;
  SELECT po.user_id INTO x2 FROM public.posts po
   WHERE po.is_public AND po.user_id <> x1 AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = po.user_id)
   GROUP BY po.user_id ORDER BY count(*) DESC, po.user_id LIMIT 1;
  SELECT po.user_id INTO m FROM public.posts po
   WHERE po.is_public AND po.user_id NOT IN (x1, x2) AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = po.user_id)
   GROUP BY po.user_id ORDER BY count(*) DESC, po.user_id LIMIT 1;
  SELECT u.id INTO a FROM auth.users u
   WHERE u.id NOT IN (x1, x2, m)
     AND NOT EXISTS (SELECT 1 FROM public.posts po WHERE po.user_id = u.id AND po.created_at > now() - interval '24 hours')
   ORDER BY (SELECT count(*) FROM public.follows f WHERE f.follower_id = u.id)
          + (SELECT count(*) FROM public.friendships f WHERE f.requester_id = u.id OR f.addressee_id = u.id), u.id
   LIMIT 1;
  IF x1 IS NULL OR x2 IS NULL OR m IS NULL OR a IS NULL THEN
    RAISE EXCEPTION 'PROBE CAST: needs three authors with public posts and a fourth account on this lane';
  END IF;
  INSERT INTO public.follows (follower_id, following_id) VALUES (a, x1), (a, x2), (a, m) ON CONFLICT DO NOTHING;
  INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (a, m) ON CONFLICT DO NOTHING;
  SELECT po.id INTO hid FROM public.posts po WHERE po.user_id = x1 AND po.is_public ORDER BY po.created_at DESC, po.id LIMIT 1;
  INSERT INTO public.feed_hidden_posts (user_id, post_id, reason) VALUES (a, hid, 'hide') ON CONFLICT DO NOTHING;
  -- A's circle as the function sees it: friends + followed, visible, not hidden, not muted
  SELECT coalesce(array_agg(po.id ORDER BY po.created_at DESC, po.id), '{}') INTO circle
    FROM public.posts po
   WHERE po.user_id IN (SELECT following_id FROM public.follows WHERE follower_id = a
                        UNION SELECT CASE WHEN requester_id = a THEN addressee_id ELSE requester_id END
                                FROM public.friendships WHERE status = 'accepted' AND (requester_id = a OR addressee_id = a))
     AND po.user_id <> a
     AND (po.is_public OR (po.privacy = 'friends' AND EXISTS (SELECT 1 FROM public.friendships f WHERE f.status = 'accepted'
            AND ((f.requester_id = a AND f.addressee_id = po.user_id) OR (f.addressee_id = a AND f.requester_id = po.user_id)))))
     AND NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts h WHERE h.user_id = a AND h.post_id = po.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_muted_authors mu WHERE mu.user_id = a AND mu.author_id = po.user_id);
  SELECT count(*) INTO n FROM unnest(circle) x(pid) JOIN public.posts po ON po.id = x.pid
   WHERE po.user_id IN (x1, x2) AND NOT EXISTS (SELECT 1 FROM public.feed_events fe WHERE fe.user_id = a AND fe.post_id = po.id);
  IF n < 14 THEN RAISE EXCEPTION 'PROBE CAST: X1 + X2 have % unseen visible posts for A (need 14)', n; END IF;
  -- six recent public posts outside A's circle → the test interest category
  SELECT array_agg(q.id) INTO sugg FROM (
    SELECT po.id FROM public.posts po
     WHERE po.is_public AND po.user_id <> a AND NOT (po.id = ANY (circle)) AND po.user_id NOT IN (x1, x2, m)
       AND po.user_id NOT IN (SELECT following_id FROM public.follows WHERE follower_id = a)
       AND NOT EXISTS (SELECT 1 FROM public.feed_events fe WHERE fe.user_id = a AND fe.post_id = po.id)
     ORDER BY po.created_at DESC, po.id LIMIT 6) q;
  IF coalesce(cardinality(sugg), 0) < 6 THEN RAISE EXCEPTION 'PROBE CAST: fewer than 6 public posts outside A''s circle'; END IF;
  UPDATE public.posts SET categories = ARRAY['s12f34-s'] WHERE id = ANY (sugg);
  INSERT INTO public.feed_viewer_category_interest (user_id, category, score, updated_at) VALUES (a, 's12f34-s', 50, now())
  ON CONFLICT (user_id, category) DO UPDATE SET score = 50, updated_at = now();

  -- G2 / G3 · as A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}'), coalesce(array_agg(f.source ORDER BY f.o), '{}'), coalesce(array_agg(f.caught_up_after ORDER BY f.o), '{}')
    INTO ids1, src1, cu1
    FROM public.get_personal_feed('{}'::uuid[], 10, 3, NULL, 'probe-seed-1')
         WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                              shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO ids1b
    FROM public.get_personal_feed('{}'::uuid[], 10, 3, NULL, 'probe-seed-1')
         WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                              shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO ids1c
    FROM public.get_personal_feed('{}'::uuid[], 10, 3, NULL, 'probe-seed-2')
         WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                              shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}'), coalesce(array_agg(f.source ORDER BY f.o), '{}') INTO ids2, src2
    FROM public.get_personal_feed(ids1, 10, 0, NULL, 'probe-seed-1')
         WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                              shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO ids3
    FROM public.get_personal_feed(ids1 || ids2, 10, 0, NULL, 'probe-seed-1')
         WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                              shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  -- G4 · caught up: everything in A's circle except the two newest unseen posts is "already delivered"
  SELECT coalesce(array_agg(q.pid ORDER BY q.o), '{}') INTO keep FROM (
    SELECT x.pid, x.o FROM unnest(circle) WITH ORDINALITY x(pid, o)
     WHERE NOT EXISTS (SELECT 1 FROM public.feed_events fe WHERE fe.user_id = a AND fe.post_id = x.pid)
     ORDER BY x.o LIMIT 2) q;
  ex := ARRAY(SELECT x.pid FROM unnest(circle) x(pid) WHERE NOT (x.pid = ANY (keep)));
  SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}'), coalesce(array_agg(f.source ORDER BY f.o), '{}'), coalesce(array_agg(f.caught_up_after ORDER BY f.o), '{}')
    INTO idsg, srcg, cug
    FROM public.get_personal_feed(ex, 10, 3, NULL, 'probe-seed-3')
         WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                              shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  RESET ROLE;

  IF NOT (array_length(ids1, 1) = 10 AND array_length(ids2, 1) = 10) THEN
    _bad := _bad || format(E'\n  G2 page sizes %s / %s (want 10 / 10)', coalesce(array_length(ids1, 1), 0), coalesce(array_length(ids2, 1), 0));
  END IF;
  FOR r IN SELECT * FROM (VALUES (1, src1), (2, src2)) v(pg, s) LOOP
    IF (SELECT count(*) FROM unnest(r.s) z WHERE z = 'circle') <> 6
       OR (SELECT count(*) FROM unnest(r.s) z WHERE z = 'suggested') <> 2
       OR (SELECT count(*) FROM unnest(r.s) z WHERE z = 'fair') <> 2 THEN
      _bad := _bad || format(E'\n  G2 page %s sources %s (want circle 6 / suggested 2 / fair 2)', r.pg, r.s);
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT z) FROM unnest(ids1 || ids2 || ids3) z) <> coalesce(array_length(ids1 || ids2 || ids3, 1), 0) THEN
    _bad := _bad || E'\n  G2 a post was delivered twice across pages 1–3';
  END IF;
  IF hid = ANY (ids1 || ids2 || ids3) THEN _bad := _bad || E'\n  G2 the hidden post was delivered'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ids1 || ids2 || ids3) z JOIN public.posts po ON po.id = z WHERE po.user_id = m) THEN
    _bad := _bad || E'\n  G2 a muted author''s post was delivered';
  END IF;
  SELECT * INTO r FROM pg_temp.s12f34_runs(ids1 || ids2 || ids3);
  IF r.author_run > 2 THEN _bad := _bad || format(E'\n  G2 %s in a row by one author (max 2)', r.author_run); END IF;
  IF r.cat_run > 3 THEN _bad := _bad || format(E'\n  G2 %s in a row sharing a category (max 3)', r.cat_run); END IF;
  n := pg_temp.s12f34_not_visible(a, ids1 || ids2 || ids3 || ids1c || idsg);
  IF n > 0 THEN _bad := _bad || format(E'\n  G2 A received %s post(s) A may not view', n); END IF;
  -- G3
  IF ids1b IS DISTINCT FROM ids1 THEN _bad := _bad || E'\n  G3 the same seed gave a different order'; END IF;
  IF ids1c IS NOT DISTINCT FROM ids1 THEN _bad := _bad || E'\n  G3 a different seed gave the same order'; END IF;
  -- G4
  IF (SELECT count(*) FROM unnest(cug) z WHERE z) <> 1 THEN
    _bad := _bad || format(E'\n  G4 caught_up_after on %s rows (want exactly 1); sources %s', (SELECT count(*) FROM unnest(cug) z WHERE z), srcg);
  ELSE
    i := array_position(cug, true);
    IF srcg[i] <> 'circle' OR idsg[i] <> keep[2] AND idsg[i] <> keep[1]
       OR (SELECT count(*) FROM unnest(srcg) z WHERE z = 'circle') <> 2
       OR EXISTS (SELECT 1 FROM generate_series(i + 1, coalesce(array_length(srcg, 1), 0)) g WHERE srcg[g] = 'circle') THEN
      _bad := _bad || format(E'\n  G4 the marker is not on the last of the two unseen circle posts (row %s, sources %s)', i, srcg);
    END IF;
  END IF;
  IF coalesce(array_length(idsg, 1), 0) <> 10 THEN _bad := _bad || format(E'\n  G4 page of %s rows (want 10: suggested/fair fill)', coalesce(array_length(idsg, 1), 0)); END IF;

  -- G5 · circle-only mix; twelve unseen X1/X2 posts share one category
  UPDATE public.feed_score_config SET value = 0 WHERE key IN ('mix_suggested', 'mix_fair');
  UPDATE public.posts SET categories = ARRAY['s12f34-k']
   WHERE id IN (SELECT x.pid FROM unnest(circle) WITH ORDINALITY x(pid, o) JOIN public.posts po ON po.id = x.pid
                 WHERE po.user_id IN (x1, x2) ORDER BY x.o LIMIT 12);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO idsp
    FROM public.get_personal_feed('{}'::uuid[], 20, 3, NULL, 'probe-seed-4')
         WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                              shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
  RESET ROLE;
  SELECT * INTO r FROM pg_temp.s12f34_runs(idsp);
  IF r.author_run > 2 OR r.cat_run > 3 THEN
    _bad := _bad || format(E'\n  G5 under pressure: author run %s (max 2), category run %s (max 3)', r.author_run, r.cat_run);
  END IF;
  UPDATE public.feed_score_config SET value = 2 WHERE key IN ('mix_suggested', 'mix_fair');

  -- G6 · cold start: the six test posts become popular (smoothed quality 0.5)
  SELECT u.id INTO c0 FROM auth.users u
   WHERE u.id NOT IN (a, x1, x2, m)
     AND (SELECT count(*) FROM public.feed_viewer_author_affinity s WHERE s.user_id = u.id)
       + (SELECT count(*) FROM public.feed_viewer_category_interest s WHERE s.user_id = u.id)
       < (SELECT value FROM public.feed_score_config WHERE key = 'cold_history_min')
     AND NOT EXISTS (SELECT 1 FROM public.feed_events fe WHERE fe.user_id = u.id AND fe.post_id = ANY (sugg))
     AND NOT EXISTS (SELECT 1 FROM public.posts po WHERE po.id = ANY (sugg) AND po.user_id = u.id)
   ORDER BY u.id LIMIT 1;
  IF c0 IS NULL THEN
    _bad := _bad || E'\n  G6 no account with fewer than cold_history_min score rows on this lane (cold start not exercised)';
  ELSE
    INSERT INTO public.feed_post_quality (post_id, score, engagement, views, updated_at)
    SELECT z, 0.5, 25, 50, now() FROM unnest(sugg) z
    ON CONFLICT (post_id) DO UPDATE SET score = 0.5, engagement = 25, views = 50, updated_at = now();
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c0, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', c0::text, true);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}'), coalesce(array_agg(f.source ORDER BY f.o), '{}') INTO idsc, srcc
      FROM public.get_personal_feed('{}'::uuid[], 10, 3, NULL, 'probe-seed-5')
           WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                                shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
    RESET ROLE;
    IF coalesce(array_length(idsc, 1), 0) = 0 OR NOT ('suggested' = ANY (srcc)) THEN
      _bad := _bad || format(E'\n  G6 cold-start member got %s rows, sources %s (want non-empty with a suggested row)', coalesce(array_length(idsc, 1), 0), srcc);
    END IF;
    n := pg_temp.s12f34_not_visible(c0, idsc);
    IF n > 0 THEN _bad := _bad || format(E'\n  G6 the cold-start member received %s post(s) they may not view', n); END IF;
  END IF;

  -- G7 · privacy: B follows a friends-only author who is not B's friend, and a private-post author
  SELECT u.id INTO b FROM auth.users u WHERE u.id NOT IN (a, x1, x2, m) AND u.id IS DISTINCT FROM c0 ORDER BY u.id LIMIT 1;
  IF b IS NULL THEN RAISE EXCEPTION 'PROBE CAST: no account for member B'; END IF;
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
  FOR i IN 1..3 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(array_agg(f.id ORDER BY f.o), '{}') INTO idsb
      FROM public.get_personal_feed(allb, 10, CASE WHEN i = 1 THEN 3 ELSE 0 END, NULL, 'probe-seed-6')
           WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count,
                                shares_count, feed_tier, author_name, author_avatar, thumbnail_urls, categories, source, caught_up_after, o);
    RESET ROLE;
    allb := allb || idsb;
  END LOOP;
  n := pg_temp.s12f34_not_visible(b, allb);
  IF n > 0 THEN _bad := _bad || format(E'\n  G7 member B received %s post(s) B may not view', n); END IF;
  IF coalesce(array_length(allb, 1), 0) = 0 THEN _bad := _bad || E'\n  G7 member B received nothing (cannot judge privacy)'; END IF;

  -- G8 · anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  failed := false;
  BEGIN
    PERFORM count(*) FROM public.get_personal_feed('{}'::uuid[], 10, 3, NULL, 'probe-anon');
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  RESET ROLE;
  IF NOT failed THEN _bad := _bad || E'\n  G8 anon could execute get_personal_feed'; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0003:%', _bad;
  END IF;

  -- G9 · NOTICE (24 h window only)
  SELECT count(*) INTO _h FROM public.posts WHERE created_at > now() - interval '24 hours';
  RAISE NOTICE 'PROBE PASS 20261018_0003 (lane %): definer + search_path '''' + authenticated only; pages 1/2 sources % / %; no repeats, hidden/muted excluded, runs ≤ 2 author / ≤ 3 category (pressure test incl.); same seed same order, new seed new order; caught_up on 1 row (sources %); cold start % rows %; B saw % rows, 0 not viewable; anon refused; switch personal_feed=% with % member(s); posts created 24 h: %',
    current_setting('p32.lane'), src1, src2, srcg, coalesce(array_length(idsc, 1), 0), srcc, coalesce(array_length(allb, 1), 0),
    _mode, (SELECT count(*) FROM public.feature_access_members WHERE feature = 'personal_feed'), _h;
END
$probe$;
ROLLBACK;
