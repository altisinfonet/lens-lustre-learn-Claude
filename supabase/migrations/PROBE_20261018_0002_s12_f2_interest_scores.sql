-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261018_0002 — S12-F2 Interest scores (staging and production)
-- Writes test rows INSIDE its own transaction and ends in ROLLBACK: nothing it
-- does survives (watermarks, scores, queue and test signals included). Raises,
-- and so fails the dispatch, on any hit. Run after 20261018_0002; FAILS before
-- it (G1: the tables do not exist).
--
--   G0 · lane guard: p32.lane must be staging or production.
--   G1 · static: the six tables exist, RLS on, NO policy; anon and
--        authenticated hold no table privilege; both functions SECURITY
--        INVOKER, search_path '', not executable by PUBLIC / anon /
--        authenticated; the config is complete and sane (hide and skip
--        negative, prior ≥ 1 view, half-life > 0); seven watermarks; the cron
--        job refresh-feed-scores is scheduled.
--   G2 · NO function in the database that PUBLIC, anon or authenticated may
--        execute has a body naming a score table — so member B cannot reach A's
--        scores through any function (the generic cross-member check).
--   G3 · behaviour (cast: public post P by C, with categories; members A, B):
--        test rows written as the owner, stamped just inside the refresh
--        window, watermarks set just before them (all rolled back):
--          A likes P, dwells 20 s, clicks "Copy link" 50 times (L8), visits C;
--          B hides P ("Not interested").
--        a. BOUNDED: refresh(_batch => 1) reads ≤ 1 row per source and
--           recomputes ≤ 1 post;
--        b. then a full refresh: A→C closeness goes UP by exactly the weighted,
--           decayed gain from feed_score_config (the 50 share clicks count as
--           ONE unit); A's interest in each of P's categories goes UP;
--           B→C closeness goes DOWN by the hide weight; B's category interest
--           goes DOWN — every check a DELTA against the decayed pre-score;
--        c. QUALITY: P's row equals the formula over distinct engagers (the 50
--           clicks add at most ONE share-clicker); the Bayesian prior pulls the
--           score strictly toward q_prior_rate (low-view noise resisted).
--   G4 · IDEMPOTENT: a third refresh reads 0 rows, writes no closeness or
--        category row, and leaves those scores, P's quality row and the
--        watermarks unchanged (it may only keep draining an OLDER quality
--        backlog, which is recompute-exact anyway).
--   G5 · privacy as real roles: member B (JWT) and anon read 0 rows of each
--        table (refused: no privilege) — B asks for A's rows by A's id — and
--        cannot execute feed_scores_refresh / feed_score_decayed.
--   G6 · NOTICE only: rows updated in the last 24 h (updated_at index), the
--        queue in the last 24 h, the oldest watermark lag.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $probe$
DECLARE
  _zero  constant uuid := '00000000-0000-0000-0000-000000000000';
  r      record;
  _bad   text := '';
  _c     jsonb;
  a      uuid;
  b      uuid;
  c      uuid;
  p      uuid;
  cats   text[];
  card   integer;
  t      timestamptz;
  dec    double precision;
  a0     double precision;
  b0     double precision;
  a1     double precision;
  b1     double precision;
  ac0    jsonb;
  bc0    jsonb;
  ac1    jsonb;
  bc1    jsonb;
  cat    text;
  gain   double precision;
  want   double precision;
  clk0   bigint;
  clk1   bigint;
  q      record;
  qq     record;
  i      integer;
  qbusy  boolean;
  eng    double precision;
  vws    integer;
  raw    double precision;
  prior  double precision;
  run1   jsonb;
  run2   jsonb;
  run3   jsonb;
  sum_a  text;
  sum_b  text;
  n      bigint;
  failed boolean;
  _h     bigint;
  _k     bigint;
  _lag   interval;
BEGIN
  -- G0 · lane guard.
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED 20261018_0002 — p32.lane reads %; dispatch apply-migration.yml with target=staging or production.',
      coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · static.
  IF to_regclass('public.feed_score_config') IS NULL OR to_regclass('public.feed_score_watermarks') IS NULL
     OR to_regclass('public.feed_viewer_author_affinity') IS NULL OR to_regclass('public.feed_viewer_category_interest') IS NULL
     OR to_regclass('public.feed_post_quality') IS NULL OR to_regclass('public.feed_post_quality_queue') IS NULL
     OR to_regprocedure('public.feed_scores_refresh(integer)') IS NULL
     OR to_regprocedure('public.feed_score_decayed(double precision, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0002 G1: the interest-score tables / functions do not exist — the migration is not applied';
  END IF;
  FOR r IN SELECT unnest(ARRAY['feed_score_config', 'feed_score_watermarks', 'feed_viewer_author_affinity',
                               'feed_viewer_category_interest', 'feed_post_quality', 'feed_post_quality_queue']) AS tb LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || r.tb)::regclass) THEN
      _bad := _bad || E'\n  G1 ' || r.tb || ': RLS not enabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tb) THEN
      _bad := _bad || E'\n  G1 ' || r.tb || ': has a policy (want none: ' ||
              (SELECT string_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ','), '; ') FROM pg_policies
                WHERE schemaname = 'public' AND tablename = r.tb) || ')';
    END IF;
    IF has_table_privilege('anon', 'public.' || r.tb, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      _bad := _bad || E'\n  G1 anon has a privilege on ' || r.tb;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || r.tb, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      _bad := _bad || E'\n  G1 authenticated has a privilege on ' || r.tb;
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['public.feed_scores_refresh(integer)',
                               'public.feed_score_decayed(double precision,timestamp with time zone)']) AS f LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc pp WHERE pp.oid = r.f::regprocedure AND NOT pp.prosecdef
                     AND pp.proconfig = ARRAY['search_path=""']) THEN
      _bad := _bad || E'\n  G1 ' || r.f || ': not SECURITY INVOKER with search_path ''''';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc pp, aclexplode(coalesce(pp.proacl, acldefault('f', pp.proowner))) x
                   WHERE pp.oid = r.f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  G1 ' || r.f || ' is executable by PUBLIC, anon or authenticated';
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(key, value) INTO _c FROM public.feed_score_config;
  IF _c IS NULL OR (SELECT count(*) FROM public.feed_score_config) < 29
     OR (_c->>'half_life_days')::float8 <= 0 OR (_c->>'q_prior_views')::float8 < 1
     OR (_c->>'w_hide')::float8 >= 0 OR (_c->>'w_skip')::float8 >= 0
     OR (_c->>'w_like')::float8 <= 0 OR (_c->>'w_share_click')::float8 <= 0 OR (_c->>'w_profile_visit')::float8 <= 0
     OR (_c->>'pair_gain_cap')::float8 <= 0 OR (_c->>'settle_seconds')::float8 < 0 THEN
    _bad := _bad || E'\n  G1 feed_score_config is incomplete or not sane: ' || coalesce(_c::text, '(empty)');
  END IF;
  IF (SELECT count(*) FROM public.feed_score_watermarks) <> 7 THEN
    _bad := _bad || E'\n  G1 feed_score_watermarks does not hold the seven sources';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-feed-scores' AND command LIKE '%feed_scores_refresh%') THEN
    _bad := _bad || E'\n  G1 cron job refresh-feed-scores missing';
  END IF;

  -- G2 · no client-executable function reads a score table.
  FOR r IN
    SELECT pp.oid::regprocedure::text AS f
      FROM pg_proc pp JOIN pg_namespace ns ON ns.oid = pp.pronamespace
     WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
       AND pp.prosrc ~ '(feed_viewer_author_affinity|feed_viewer_category_interest|feed_post_quality|feed_score_config|feed_score_watermarks)'
       AND (has_function_privilege('anon', pp.oid, 'EXECUTE') OR has_function_privilege('authenticated', pp.oid, 'EXECUTE'))
  LOOP
    _bad := _bad || E'\n  G2 ' || r.f || ' reads a score table and is executable by anon / authenticated';
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0002:%', _bad;
  END IF;

  -- G3 · the cast. P: newest public post with categories by an account; if none
  -- on this lane, the newest public post gets a test category (rolled back).
  SELECT po.id, po.user_id, po.categories INTO p, c, cats
    FROM public.posts po
   WHERE po.privacy = 'public' AND cardinality(po.categories) > 0
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = po.user_id)
   ORDER BY po.created_at DESC LIMIT 1;
  IF p IS NULL THEN
    SELECT po.id, po.user_id INTO p, c FROM public.posts po
     WHERE po.privacy = 'public' AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = po.user_id)
     ORDER BY po.created_at DESC LIMIT 1;
    IF p IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G3: no public post by an account on this lane'; END IF;
    UPDATE public.posts SET categories = ARRAY['s12f2-probe'] WHERE id = p;
    cats := ARRAY['s12f2-probe'];
  END IF;
  card := cardinality(cats);
  -- test rows are stamped t, 1 s inside the refresh window (now() − settle); the
  -- watermarks are set 1 s before t. A and B must have no real activity of
  -- their own from t − 2 s on, so every delta below is the probe's alone.
  t := now() - make_interval(secs => (_c->>'settle_seconds')::float8 + 1);
  SELECT u.id INTO a FROM auth.users u
   WHERE u.id <> c
     AND NOT EXISTS (SELECT 1 FROM public.post_reactions x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.post_comments x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.post_shares x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.follows x WHERE x.created_at >= t - interval '2 seconds' AND x.follower_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_signal_events x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.post_reactions x WHERE x.post_id = p AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts x WHERE x.post_id = p AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_viewer_author_affinity x WHERE x.user_id = u.id AND x.author_id = c AND x.score > 50)
   ORDER BY u.id LIMIT 1;
  SELECT u.id INTO b FROM auth.users u
   WHERE u.id <> c AND u.id <> a
     AND NOT EXISTS (SELECT 1 FROM public.post_reactions x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.post_comments x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.post_shares x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.follows x WHERE x.created_at >= t - interval '2 seconds' AND x.follower_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_signal_events x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts x WHERE x.created_at >= t - interval '2 seconds' AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts x WHERE x.post_id = p AND x.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.feed_viewer_author_affinity x WHERE x.user_id = u.id AND x.author_id = c AND x.score < -50)
   ORDER BY u.id LIMIT 1;
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G3: fewer than two usable accounts besides the post author'; END IF;

  -- the single runner: wait for any cron run in flight, then hold the lock to the ROLLBACK
  PERFORM pg_advisory_xact_lock(2026101802);

  -- pre-scores, decayed to now (DELTAS: A, B and C are real accounts)
  SELECT coalesce(max(public.feed_score_decayed(score, updated_at)), 0) INTO a0 FROM public.feed_viewer_author_affinity WHERE user_id = a AND author_id = c;
  SELECT coalesce(max(public.feed_score_decayed(score, updated_at)), 0) INTO b0 FROM public.feed_viewer_author_affinity WHERE user_id = b AND author_id = c;
  SELECT coalesce(jsonb_object_agg(category, public.feed_score_decayed(score, updated_at)), '{}') INTO ac0
    FROM public.feed_viewer_category_interest WHERE user_id = a AND category = ANY (cats);
  SELECT coalesce(jsonb_object_agg(category, public.feed_score_decayed(score, updated_at)), '{}') INTO bc0
    FROM public.feed_viewer_category_interest WHERE user_id = b AND category = ANY (cats);
  SELECT count(*) INTO clk0 FROM public.feed_post_signals WHERE post_id = p AND share_clicks > 0;

  -- test rows. The profile visit is stamped 0.5 s EARLIER than the rest so it is
  -- A's first signal in (created_at, id) order: the bounded run (one row per
  -- source) can then never split A's 50 share clicks across two runs (one unit
  -- per run is the design; a split would make two).
  INSERT INTO public.post_reactions (id, post_id, user_id, reaction_type, created_at) VALUES (gen_random_uuid(), p, a, 'like', t);
  INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value, created_at)
  SELECT gen_random_uuid(), a, 'share_click', p, c, 0, t FROM generate_series(1, 50);
  INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value, created_at) VALUES
    (gen_random_uuid(), a, 'dwell', p, c, 20000, t),
    (gen_random_uuid(), a, 'profile_visit', NULL, c, 0, t - interval '500 milliseconds');
  INSERT INTO public.feed_hidden_posts (user_id, post_id, reason, created_at) VALUES (b, p, 'not_interested', t);
  UPDATE public.feed_score_watermarks SET wm_at = t - interval '1 second', wm_k1 = _zero, wm_k2 = _zero;

  -- a · bounded
  run1 := public.feed_scores_refresh(1);
  FOR r IN SELECT key, value FROM jsonb_each(run1->'rows') LOOP
    IF (r.value)::text::int > 1 THEN _bad := _bad || E'\n  G3a refresh(1) read ' || r.value::text || ' rows from ' || r.key || ' (want <= 1)'; END IF;
  END LOOP;
  IF (run1->>'quality')::int > 1 OR (run1->'rows') IS NULL OR (run1->'rows'->>'signals')::int <> 1 THEN
    _bad := _bad || E'\n  G3a refresh(1) not bounded to one row per source / one post: ' || run1::text;
  END IF;

  -- b · full refresh: directions and exact deltas
  run2 := public.feed_scores_refresh();
  -- P is queued behind any older backlog (<= quality_batch per run): drain up to 5 more runs
  FOR i IN 1..5 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM public.feed_post_quality WHERE post_id = p AND updated_at = now())
              AND NOT EXISTS (SELECT 1 FROM public.feed_post_quality_queue WHERE post_id = p);
    PERFORM public.feed_scores_refresh();
  END LOOP;
  dec := exp(-ln(2::float8) * extract(epoch FROM now() - t)::float8 / ((_c->>'half_life_days')::float8 * 86400));
  SELECT score INTO a1 FROM public.feed_viewer_author_affinity WHERE user_id = a AND author_id = c AND updated_at = now();
  SELECT score INTO b1 FROM public.feed_viewer_author_affinity WHERE user_id = b AND author_id = c AND updated_at = now();
  -- A: like + dwell (20 s of 30) + ONE share-click unit (not 50) + profile visit
  gain := ((_c->>'w_like')::float8 + (_c->>'w_dwell')::float8 * (20000.0 / 30000.0) + (_c->>'w_share_click')::float8) * dec
        + (_c->>'w_profile_visit')::float8
          * exp(-ln(2::float8) * extract(epoch FROM now() - (t - interval '500 milliseconds'))::float8 / ((_c->>'half_life_days')::float8 * 86400));
  want := LEAST((_c->>'score_max')::float8, GREATEST((_c->>'score_min')::float8, a0 + LEAST(gain, (_c->>'pair_gain_cap')::float8)));
  IF a1 IS NULL OR NOT a1 > a0 OR abs(a1 - want) > 1e-6 THEN
    _bad := _bad || E'\n  G3b A→C closeness ' || coalesce(a1::text, 'not updated') || ' from ' || a0 || ' (want ' || want || ': like + dwell + ONE share-click unit + visit, decayed)';
  END IF;
  want := LEAST((_c->>'score_max')::float8, GREATEST((_c->>'score_min')::float8, b0 + (_c->>'w_hide')::float8 * dec));
  IF b1 IS NULL OR NOT b1 < b0 OR abs(b1 - want) > 1e-6 THEN
    _bad := _bad || E'\n  G3b B→C closeness after a hide ' || coalesce(b1::text, 'not updated') || ' from ' || b0 || ' (want ' || want || ', DOWN)';
  END IF;
  SELECT coalesce(jsonb_object_agg(category, score), '{}') INTO ac1
    FROM public.feed_viewer_category_interest WHERE user_id = a AND category = ANY (cats) AND updated_at = now();
  SELECT coalesce(jsonb_object_agg(category, score), '{}') INTO bc1
    FROM public.feed_viewer_category_interest WHERE user_id = b AND category = ANY (cats) AND updated_at = now();
  FOREACH cat IN ARRAY cats LOOP
    CONTINUE WHEN length(cat) NOT BETWEEN 1 AND 64;
    IF (ac1->>cat) IS NULL OR NOT (ac1->>cat)::float8 > coalesce((ac0->>cat)::float8, 0) THEN
      _bad := _bad || E'\n  G3b A''s interest in "' || cat || '" ' || coalesce(ac1->>cat, 'not updated') || ' from ' || coalesce(ac0->>cat, '0') || ' (want UP)';
    END IF;
    IF (bc1->>cat) IS NULL OR NOT (bc1->>cat)::float8 < coalesce((bc0->>cat)::float8, 0) THEN
      _bad := _bad || E'\n  G3b B''s interest in "' || cat || '" ' || coalesce(bc1->>cat, 'not updated') || ' from ' || coalesce(bc0->>cat, '0') || ' (want DOWN after a hide)';
    END IF;
  END LOOP;

  -- c · quality: formula over distinct engagers; 50 clicks → at most one more share-clicker; smoothing
  SELECT count(*) INTO clk1 FROM public.feed_post_signals WHERE post_id = p AND share_clicks > 0;
  IF clk1 - clk0 > 1 THEN _bad := _bad || E'\n  G3c 50 share clicks by one member made ' || (clk1 - clk0) || ' share-clickers (want <= 1)'; END IF;
  SELECT * INTO q FROM public.feed_post_quality WHERE post_id = p AND updated_at = now();
  SELECT GREATEST(0::float8,
           (_c->>'q_like')::float8 * LEAST(GREATEST(po.likes_count, 0), (_c->>'q_count_cap')::int)
         + (_c->>'q_comment')::float8 * (SELECT count(DISTINCT cm.user_id) FROM public.post_comments cm WHERE cm.post_id = p AND cm.user_id <> po.user_id)
         + (_c->>'q_share')::float8 * LEAST(GREATEST(po.shares_count, 0), (_c->>'q_count_cap')::int)
         + (_c->>'q_share_click')::float8 * clk1
         - (_c->>'q_hide')::float8 * (SELECT count(*) FROM public.feed_hidden_posts h WHERE h.post_id = p)),
         GREATEST(po.viewer_count, LEAST(GREATEST(po.likes_count, 0), (_c->>'q_count_cap')::int),
                  LEAST(GREATEST(po.shares_count, 0), (_c->>'q_count_cap')::int), clk1::int,
                  (SELECT count(*) FROM public.feed_hidden_posts h WHERE h.post_id = p)::int,
                  (SELECT count(DISTINCT cm.user_id) FROM public.post_comments cm WHERE cm.post_id = p AND cm.user_id <> po.user_id)::int)
    INTO eng, vws FROM public.posts po WHERE po.id = p;
  prior := (_c->>'q_prior_rate')::float8;
  IF q IS NULL OR abs(q.engagement - eng) > 1e-9 OR q.views <> vws
     OR abs(q.score - (eng + prior * (_c->>'q_prior_views')::float8) / GREATEST(vws + (_c->>'q_prior_views')::float8, 1)) > 1e-9 THEN
    _bad := _bad || E'\n  G3c P''s quality ' || coalesce(row_to_json(q)::text, 'not recomputed') || ' (want engagement ' || eng || ', views ' || vws || ', smoothed score)';
  ELSE
    raw := eng / GREATEST(vws, 1);
    IF raw <> prior AND NOT abs(q.score - prior) < abs(raw - prior) THEN
      _bad := _bad || E'\n  G3c no smoothing: score ' || q.score || ', raw ' || raw || ', prior ' || prior;
    END IF;
  END IF;

  -- G4 · idempotent: a third run reads nothing and changes nothing
  SELECT coalesce(string_agg(user_id || '>' || author_id || '=' || score, ',' ORDER BY user_id, author_id), '')
         || '|' || (SELECT coalesce(string_agg(user_id || '>' || category || '=' || score, ',' ORDER BY user_id, category), '')
                      FROM public.feed_viewer_category_interest WHERE updated_at = now())
         || '|' || (SELECT coalesce(max(post_id || '=' || score || '/' || engagement || '/' || views), '')
                      FROM public.feed_post_quality WHERE post_id = p)
         || '|' || (SELECT string_agg(source || '@' || wm_at || '/' || wm_k1 || '/' || wm_k2, ',' ORDER BY source) FROM public.feed_score_watermarks)
    INTO sum_a FROM public.feed_viewer_author_affinity WHERE updated_at = now();
  qbusy := EXISTS (SELECT 1 FROM public.feed_post_quality_queue);  -- an older backlog may still drain
  run3 := public.feed_scores_refresh();
  SELECT coalesce(string_agg(user_id || '>' || author_id || '=' || score, ',' ORDER BY user_id, author_id), '')
         || '|' || (SELECT coalesce(string_agg(user_id || '>' || category || '=' || score, ',' ORDER BY user_id, category), '')
                      FROM public.feed_viewer_category_interest WHERE updated_at = now())
         || '|' || (SELECT coalesce(max(post_id || '=' || score || '/' || engagement || '/' || views), '')
                      FROM public.feed_post_quality WHERE post_id = p)
         || '|' || (SELECT string_agg(source || '@' || wm_at || '/' || wm_k1 || '/' || wm_k2, ',' ORDER BY source) FROM public.feed_score_watermarks)
    INTO sum_b FROM public.feed_viewer_author_affinity WHERE updated_at = now();
  IF (SELECT coalesce(sum(value::text::int), 0) FROM jsonb_each(run3->'rows')) <> 0
     OR (run3->>'affinity')::int <> 0 OR (run3->>'category')::int <> 0
     OR ((run3->>'quality')::int <> 0 AND NOT qbusy) THEN
    _bad := _bad || E'\n  G4 a second run over the same rows did work again: ' || run3::text;
  END IF;
  IF sum_a IS DISTINCT FROM sum_b THEN
    _bad := _bad || E'\n  G4 a second run changed scores or watermarks (not idempotent)';
  END IF;

  -- G5 · privacy as real roles: B (asking for A's rows by id), then anon
  FOR r IN SELECT * FROM (VALUES ('member B', 'authenticated'), ('anon', 'anon')) v(who, rl) LOOP
    IF r.rl = 'authenticated' THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', b::text, true);
      SET LOCAL ROLE authenticated;
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      SET LOCAL ROLE anon;
    END IF;
    FOR qq IN SELECT * FROM (VALUES
        ('feed_viewer_author_affinity', format('SELECT count(*) FROM public.feed_viewer_author_affinity WHERE user_id = %L', a)),
        ('feed_viewer_category_interest', format('SELECT count(*) FROM public.feed_viewer_category_interest WHERE user_id = %L', a)),
        ('feed_post_quality', 'SELECT count(*) FROM public.feed_post_quality'),
        ('feed_post_quality_queue', 'SELECT count(*) FROM public.feed_post_quality_queue'),
        ('feed_score_config', 'SELECT count(*) FROM public.feed_score_config'),
        ('feed_score_watermarks', 'SELECT count(*) FROM public.feed_score_watermarks')) v(tb, sql) LOOP
      n := 0;
      BEGIN
        EXECUTE qq.sql INTO n;
      EXCEPTION WHEN insufficient_privilege THEN n := 0;
      END;
      IF n <> 0 THEN _bad := _bad || E'\n  G5 ' || r.who || ' read ' || n || ' row(s) of ' || qq.tb; END IF;
    END LOOP;
    FOR qq IN SELECT * FROM (VALUES ('SELECT public.feed_scores_refresh(1)'), ('SELECT public.feed_score_decayed(1, now())')) v(sql) LOOP
      failed := false;
      BEGIN
        EXECUTE qq.sql;
      EXCEPTION WHEN insufficient_privilege THEN failed := true;
      END;
      IF NOT failed THEN _bad := _bad || E'\n  G5 ' || r.who || ' could run: ' || qq.sql; END IF;
    END LOOP;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0002:%', _bad;
  END IF;

  -- G6 · NOTICE: volume (24 h windows only), watermark lag.
  SELECT count(*) INTO _h FROM public.feed_viewer_author_affinity WHERE updated_at > now() - interval '24 hours';
  SELECT count(*) INTO _k FROM public.feed_post_quality_queue WHERE queued_at > now() - interval '24 hours';
  SELECT now() - min(wm_at) INTO _lag FROM public.feed_score_watermarks;
  RAISE NOTICE 'PROBE PASS 20261018_0002 (lane %): RLS on + no policy + no client privilege on 6 tables; no client-executable function reads them; B and anon read 0 rows and cannot run the functions; bounded run %; A→C % → % (like + dwell + 1 share-click unit for 50 clicks + visit); B→C % → % (hide); categories % (A up, B down); quality P %/% views → % (prior %); second run %; closeness rows updated 24 h: %; queue 24 h: %; watermark lag %',
    current_setting('p32.lane'), run1->'rows', round(a0::numeric, 3), round(a1::numeric, 3), round(b0::numeric, 3), round(b1::numeric, 3),
    cats, round(q.engagement::numeric, 2), q.views, round(q.score::numeric, 4), prior, run3, _h, _k, _lag;
END
$probe$;
ROLLBACK;
