-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261029_0101 — S3-c resolved post media (staging and production)
-- Ends in ROLLBACK (the switch flips it makes are undone). Counts/booleans only.
-- FAILS before 20261029_0101 (G1); PASSES after.
--
--   G1 · static: post_media_resolved_for is SECURITY DEFINER, search_path '',
--        authenticated may execute, anon and PUBLIC may not; media_cdn_origin is
--        closed to clients; the switch row exists and is OFF; the return columns
--        are EXACTLY post_id, ord, media_id, width, height, mime, url.
--   G2 · media_cdn_origin() is a bare https origin, and for every sampled public
--        post in the media graph  origin || '/' || original  is one of the
--        post's image_urls (the URL is built for the right host).
--   G3 · behaviour (SET LOCAL ROLE + JWT claims):
--        a. switch OFF → member A gets 0 rows for a ladder-complete public post;
--        b. switch 'selected' with A on the list → A gets 3 rows per slide, all
--           image/webp, every url under the origin and containing '/d/', none
--           equal to an original, every width/height ≤ 1440;
--        c. CROSS-MEMBER: B (not on the list) gets 0 rows for the same post;
--        d. A gets 0 rows for a non-public post of another member it cannot
--           view (and for any non-public post: that branch is 0102's);
--        e. anon cannot execute; 51 ids → MEDIA-1001.
--   b/c/d need a ladder-complete public post on the lane (after the backfill);
--   before it they are reported as "skipped: no complete post" — run again
--   after the backfill for the full proof.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $g$
DECLARE
  f text := 'public.post_media_resolved_for(uuid[])';
  cols text; origin text; mism int; sampled int;
  a uuid; b uuid; post uuid; nonpub uuid; n int; n_bad int; ok boolean; detail text := 'skipped: no complete post';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- G1
  IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G1: % missing', f; END IF;
  IF NOT (SELECT prosecdef AND 'search_path=""' = ANY(coalesce(proconfig, '{}')) FROM pg_proc WHERE oid = to_regprocedure(f)) THEN
    RAISE EXCEPTION 'PROBE FAIL G1: not SECURITY DEFINER with empty search_path';
  END IF;
  IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.media_cdn_origin()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.media_cdn_origin()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure(f) AND x.grantee = 0) THEN
    RAISE EXCEPTION 'PROBE FAIL G1: privileges';
  END IF;
  SELECT string_agg(n_, ',' ORDER BY i) INTO cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS t(n_, m_, i)
   WHERE p.oid = to_regprocedure(f) AND m_ = 't';
  IF cols IS DISTINCT FROM 'post_id,ord,media_id,width,height,mime,url' THEN
    RAISE EXCEPTION 'PROBE FAIL G1: return columns are %', cols;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'media_ladder_feed' AND mode = 'off') THEN
    RAISE EXCEPTION 'PROBE FAIL G1: switch media_ladder_feed missing or not off';
  END IF;

  -- G2
  origin := public.media_cdn_origin();
  IF origin IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G2: s3_storage_settings.public_url is not a bare https origin'; END IF;
  SELECT count(*), count(*) FILTER (WHERE NOT coalesce(origin || '/' || (mo.derivatives->>'original') = ANY(p.image_urls), false))
    INTO sampled, mism
    FROM (SELECT * FROM public.post_media ORDER BY post_id LIMIT 200) pm
    JOIN public.posts p ON p.id = pm.post_id AND p.privacy = 'public'
    JOIN public.media_objects mo ON mo.id = pm.media_id;
  IF sampled > 0 AND mism > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL G2: % of % sampled originals do not match image_urls under media_cdn_origin()', mism, sampled;
  END IF;

  -- G3 setup: two non-admin members; a ladder-complete public post by somebody
  SELECT p.id INTO a FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.has_role(p.id, 'admin'::public.app_role) ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO b FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.id <> a AND NOT public.has_role(p.id, 'admin'::public.app_role) ORDER BY p.created_at LIMIT 1;
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G3: need two non-admin members'; END IF;
  SELECT pm.post_id INTO post FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id AND p.privacy = 'public'
    JOIN public.media_objects mo ON mo.id = pm.media_id
   GROUP BY pm.post_id HAVING bool_and(mo.state = 'ready' AND mo.derivatives ?& ARRAY['600', '1080', '1440']) LIMIT 1;
  SELECT p.id INTO nonpub FROM public.posts p
   WHERE p.privacy <> 'public' AND p.user_id <> a AND NOT public.can_view_post(a, p.user_id, p.privacy) LIMIT 1;

  -- a. switch off
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.post_media_resolved_for(ARRAY[coalesce(post, gen_random_uuid())]);
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G3a: % rows with the switch off', n; END IF;

  -- switch selected, A on the list (undone by the final ROLLBACK)
  UPDATE public.feature_access SET mode = 'selected' WHERE feature = 'media_ladder_feed';
  INSERT INTO public.feature_access_members (feature, user_id) VALUES ('media_ladder_feed', a);

  IF post IS NOT NULL THEN
    -- b. A sees the ladder
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*),
           count(*) FILTER (WHERE r.mime <> 'image/webp' OR r.url NOT LIKE origin || '/%' OR r.url NOT LIKE '%/d/%'
                                  OR greatest(r.width, r.height) > 1440)
      INTO n, n_bad FROM public.post_media_resolved_for(ARRAY[post]) r;
    RESET ROLE;
    IF n = 0 OR n % 3 <> 0 OR n_bad <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G3b: A got % rows, % malformed', n, n_bad; END IF;
    IF EXISTS (SELECT 1 FROM public.post_media pm JOIN public.media_objects mo ON mo.id = pm.media_id
                WHERE pm.post_id = post AND origin || '/' || (mo.derivatives->>'original') IN
                      (SELECT r.url FROM public.post_media_resolved_for(ARRAY[post]) r)) THEN
      RAISE EXCEPTION 'PROBE FAIL G3b: an original was returned';
    END IF;
    -- c. B is not on the list
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.post_media_resolved_for(ARRAY[post]);
    RESET ROLE;
    IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G3c: member B (switch not on for B) got % rows', n; END IF;
    detail := 'A: ladder rows ok; B: 0';
  END IF;

  -- d. a non-public post A cannot view → 0
  IF nonpub IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', a::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.post_media_resolved_for(ARRAY[nonpub]);
    RESET ROLE;
    IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G3d: A got % rows of a post A cannot view', n; END IF;
    detail := detail || '; non-viewable post: 0';
  END IF;

  -- e. anon; cap
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM * FROM public.post_media_resolved_for(ARRAY[gen_random_uuid()]); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G3e: anon executed post_media_resolved_for'; END IF;
  ok := false;
  BEGIN PERFORM * FROM public.post_media_resolved_for(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 51)));
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G3e: 51 ids were not refused'; END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'PROBE PASS 20261029_0101 (lane %): definer/search_path ''''/no anon/no PUBLIC; columns exactly the 7 allowed; switch off; origin ok, % sampled originals match image_urls; off → 0 rows; %; anon refused; 51 ids refused',
    current_setting('p32.lane', true), sampled, detail;
END
$g$;

ROLLBACK;
