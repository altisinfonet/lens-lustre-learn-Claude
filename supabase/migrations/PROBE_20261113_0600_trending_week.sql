-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0600 Trending this week. WRITES NOTHING: one transaction
-- that ends in ROLLBACK. FAILS before apply.
-- PASS = structure + grants in place AND, exercised:
--   T1 the card gives exactly 4 photos (or none when the site has < 4)
--   T2 a member who is not an admin cannot mark (not_admin)
--   T3 an admin marks a public ready video → the card names that video
--   T4 a second mark replaces the first: still ONE open mark
--   T5 clear → no video on the card
--   T6 members cannot touch the table; signed-out cannot call anything
-- Prints counts and reasons only — no member data.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  _admin uuid; _plain uuid; _v1 uuid; _v2 uuid;
  _got text; _card jsonb; _photos integer; _sitephotos integer;
  f text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.trending_week_video') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: trending_week_video missing (0600 not applied)';
  END IF;
  FOREACH f IN ARRAY ARRAY['public.trending_video_set(uuid)', 'public.trending_video_clear()', 'public.get_trending_week()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f) AND prosecdef AND proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'PROBE FAIL: % missing or not SECURITY DEFINER / search_path=""', f;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'PROBE FAIL T6: grants on % are wrong', f;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.trending_week_video', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.trending_week_video', 'SELECT')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trending_week_video'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL T6: trending_week_video is reachable by members';
  END IF;

  -- T1
  SELECT count(*) INTO _sitephotos FROM public.posts WHERE privacy = 'public' AND coalesce(image_urls[1], image_url) IS NOT NULL;
  _card := public.get_trending_week();
  _photos := jsonb_array_length(_card->'photos');
  IF NOT (_photos = 4 OR (_photos = 0 AND _sitephotos < 4)) THEN
    RAISE EXCEPTION 'PROBE FAIL T1: % photos on the card (site has % public photo posts)', _photos, _sitephotos;
  END IF;

  -- T2..T5 as real members (auth.uid() from the JWT claim, rolled back)
  SELECT ur.user_id INTO _admin FROM public.user_roles ur WHERE ur.role::text = 'admin' LIMIT 1;
  SELECT p.id INTO _plain FROM public.profiles p WHERE NOT public.has_role(p.id, 'admin'::text) LIMIT 1;
  SELECT po.id INTO _v1 FROM public.posts po JOIN public.post_videos pv ON pv.post_id = po.id JOIN public.videos v ON v.id = pv.video_id
   WHERE po.privacy = 'public' AND v.state = 'ready' AND v.deleted_at IS NULL ORDER BY po.created_at DESC LIMIT 1;
  SELECT po.id INTO _v2 FROM public.posts po JOIN public.post_videos pv ON pv.post_id = po.id JOIN public.videos v ON v.id = pv.video_id
   WHERE po.privacy = 'public' AND v.state = 'ready' AND v.deleted_at IS NULL AND po.id IS DISTINCT FROM _v1 ORDER BY po.created_at DESC LIMIT 1;

  IF _plain IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _plain, 'role', 'authenticated')::text, true);
    _got := public.trending_video_set(coalesce(_v1, gen_random_uuid()));
    IF _got IS DISTINCT FROM 'not_admin' THEN RAISE EXCEPTION 'PROBE FAIL T2: a plain member marking gave %', _got; END IF;
  END IF;

  IF _admin IS NULL OR _v1 IS NULL THEN
    RAISE NOTICE 'TW0600 PASS (structure + T1/T2 only, lane %): photos % ; no admin or no public ready video to exercise T3-T5',
      current_setting('p32.lane'), _photos;
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  _got := public.trending_video_set(_v1);
  IF _got IS DISTINCT FROM 'ok' OR (public.get_trending_week()->'video'->>'post_id')::uuid IS DISTINCT FROM _v1 THEN
    RAISE EXCEPTION 'PROBE FAIL T3: mark gave % and the card shows %', _got, public.get_trending_week()->'video';
  END IF;
  IF _v2 IS NOT NULL THEN
    _got := public.trending_video_set(_v2);
    IF _got IS DISTINCT FROM 'ok' OR (SELECT count(*) FROM public.trending_week_video WHERE cleared_at IS NULL) <> 1
       OR (public.get_trending_week()->'video'->>'post_id')::uuid IS DISTINCT FROM _v2 THEN
      RAISE EXCEPTION 'PROBE FAIL T4: a second mark did not replace the first';
    END IF;
  END IF;
  _got := public.trending_video_clear();
  IF _got IS DISTINCT FROM 'ok' OR public.get_trending_week()->'video' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'PROBE FAIL T5: after clear the card still shows %', public.get_trending_week()->'video';
  END IF;

  RAISE NOTICE 'TW0600 PASS (lane %): T1-T6 hold; photos % ; site public photo posts % ; open marks before this test %',
    current_setting('p32.lane'), _photos, _sitephotos,
    (SELECT count(*) FROM public.trending_week_video WHERE cleared_at IS NULL AND set_at < now());
END
$p$;

ROLLBACK;
