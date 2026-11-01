-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S9 · feed latency at the current scale (read-path, server side).
-- STAGING ONLY. ONE TRANSACTION, ALWAYS ROLLED BACK.
--
-- What it answers: how long the feed RPCs the app calls take inside the
-- database, as a real signed-in member, at whatever number of posts staging
-- holds when it runs. Run it BEFORE the 1 M seed (baseline) and AFTER it (at
-- scale); the two readings are the S9 "feed p95 at 1 M rows" claim.
--
-- The calls, exactly as src/hooks/feed/useFeedQuery.ts makes them (page 10):
--   FP  get_feed_page('for_you', true,  seed, _after, 10, 3|0, NULL)  personal on
--   FB  get_feed_page('for_you', false, seed, _after, 10, 3|0, NULL)  personal off
--   PF  get_personal_feed('{}', 10, 3, NULL, seed)                     older bundles
--   BF  get_broadcast_feed('{}', 10, 3, NULL, seed)                    older bundles
-- FP / FB scroll like a member: 5 pages per session, each page's _after = the
-- highest feed_pos already delivered, 12 sessions each (60 calls); PF / BF are
-- page 1 only, 12 calls each. Timing = clock_timestamp() around each call.
--
-- Viewer: the member who follows the most accounts (the personal feed has the
-- most to merge for them). The id is never printed.
--
-- get_feed_page is VOLATILE (it writes the session's delivery log). Everything
-- it writes is undone by the ROLLBACK at the end. No shared object is changed.
--
-- PASS = every call returned without error and page 1 returned rows; the
-- numbers are printed as S9F|<rpc>|calls|p50|p95|max (ms) for comparison.
-- FAIL = an error, or an empty first page (a broken feed is not a fast one).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $probe$
DECLARE
  lane      text := current_setting('p32.lane', true);
  viewer    uuid;
  n_posts   bigint;
  n_seeded  bigint;
  t0        timestamptz;
  ms        double precision;
  after_pos integer;
  mx_pos    integer;
  got       integer;
  first_ok  boolean := true;
  v         text;
  t_fp      double precision[] := '{}';
  t_fb      double precision[] := '{}';
  t_pf      double precision[] := '{}';
  t_bf      double precision[] := '{}';
  s         integer;
  pg        integer;
  r         record;
BEGIN
  IF lane IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'PROBE FAIL 0803: staging only (p32.lane = %)', coalesce(lane, '<unset>');
  END IF;

  SELECT count(*) INTO n_posts FROM public.posts;
  SELECT count(*) INTO n_seeded FROM public.posts p
   WHERE p.content LIKE '[seed 50mm-seed-v1]%';
  SELECT f.follower_id INTO viewer
    FROM public.follows f JOIN public.profiles pr ON pr.id = f.follower_id
   GROUP BY f.follower_id ORDER BY count(*) DESC, f.follower_id LIMIT 1;
  IF viewer IS NULL THEN RAISE EXCEPTION 'PROBE FAIL 0803: no member follows anyone'; END IF;
  RAISE NOTICE 'S9F|scale|posts=%|seeded=%', n_posts, n_seeded;

  -- Become that member, the way PostgREST does for a signed-in request.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', viewer::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  FOREACH v IN ARRAY ARRAY['FP', 'FB'] LOOP
    FOR s IN 1..12 LOOP
      after_pos := NULL;
      FOR pg IN 1..5 LOOP
        t0 := clock_timestamp();
        SELECT count(*)::int, max(x.feed_pos) INTO got, mx_pos
          FROM public.get_feed_page('for_you', v = 'FP', 's9f-' || v || '-' || s, after_pos,
                                    10, CASE WHEN pg = 1 THEN 3 ELSE 0 END, NULL::text[]) x;
        ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
        IF v = 'FP' THEN t_fp := t_fp || ms; ELSE t_fb := t_fb || ms; END IF;
        IF pg = 1 AND got = 0 THEN first_ok := false; END IF;
        after_pos := coalesce(mx_pos, after_pos);
      END LOOP;
    END LOOP;
  END LOOP;

  FOR s IN 1..12 LOOP
    t0 := clock_timestamp();
    SELECT count(*)::int INTO got FROM public.get_personal_feed('{}'::uuid[], 10, 3, NULL::text[], 's9f-PF-' || s);
    t_pf := t_pf || extract(epoch FROM clock_timestamp() - t0) * 1000;
    IF got = 0 THEN first_ok := false; END IF;
    t0 := clock_timestamp();
    SELECT count(*)::int INTO got FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[], 's9f-BF-' || s);
    t_bf := t_bf || extract(epoch FROM clock_timestamp() - t0) * 1000;
    IF got = 0 THEN first_ok := false; END IF;
  END LOOP;

  EXECUTE 'RESET ROLE';

  FOR r IN
    SELECT k, cardinality(a) AS calls,
           round((SELECT percentile_cont(0.50) WITHIN GROUP (ORDER BY u) FROM unnest(a) u)::numeric, 1) AS p50,
           round((SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY u) FROM unnest(a) u)::numeric, 1) AS p95,
           round((SELECT max(u) FROM unnest(a) u)::numeric, 1) AS mx
      FROM (VALUES ('get_feed_page personal', t_fp), ('get_feed_page broadcast', t_fb),
                   ('get_personal_feed p1', t_pf), ('get_broadcast_feed p1', t_bf)) AS q(k, a)
  LOOP
    RAISE NOTICE 'S9F|%|calls=%|p50=% ms|p95=% ms|max=% ms', r.k, r.calls, r.p50, r.p95, r.mx;
  END LOOP;

  IF NOT first_ok THEN
    RAISE EXCEPTION 'PROBE FAIL 0803: a first feed page came back empty at posts=%', n_posts;
  END IF;
  RAISE NOTICE 'PROBE PASS 0803 (lane %): feed timed at posts=% (seeded=%); see S9F lines. All rolled back.',
               lane, n_posts, n_seeded;
END
$probe$;

ROLLBACK;
