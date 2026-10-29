-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261029_0102 — S3-d private photo branch (staging and production)
-- Self-contained and ENDS IN ROLLBACK: inside its own transaction it turns one
-- post with media (or, on a lane with none, a fixture media row it attaches to a
-- non-admin's post) into an only-me post, records a (fake) private ladder for it
-- and flips the switches — all of it undone. Counts/booleans only.
-- FAILS before 20261029_0102 (G1: no media_private_photos row); PASSES after.
--
--   G1 · the switch row exists; post_media_resolved_for is still SECURITY
--        DEFINER, search_path '', no anon/PUBLIC, same 7 columns.
--   G2 · as real members (SET LOCAL ROLE + JWT claims), both switches 'everyone':
--        a. the AUTHOR (can view their own only-me post) gets 3 rows per slide,
--           every url under <origin>/photo/<author>/, none under /d/, none an original;
--        b. CROSS-MEMBER: another non-admin member B (cannot view it) gets 0 rows;
--        c. media_private_photos OFF → the author gets 0 rows for it (0101 behaviour);
--        d. the same post made public again, public ladder complete (seeded,
--           rolled back) → the author gets rows, all /d/ (public), never /photo/;
--        e. anon cannot execute.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $g$
DECLARE
  f text := 'public.post_media_resolved_for(uuid[])';
  cols text; origin text; post uuid; author uuid; b uuid; n int; n_bad int; ok boolean;
  fx_media uuid; fixture text := 'existing post';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- G1
  IF NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'media_private_photos') THEN
    RAISE EXCEPTION 'PROBE FAIL G1: switch media_private_photos missing (20261029_0102 not applied)';
  END IF;
  IF NOT (SELECT prosecdef AND 'search_path=""' = ANY(coalesce(proconfig, '{}')) FROM pg_proc WHERE oid = to_regprocedure(f))
     OR NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure(f) AND x.grantee = 0) THEN
    RAISE EXCEPTION 'PROBE FAIL G1: definer / search_path / privileges';
  END IF;
  SELECT string_agg(n_, ',' ORDER BY i) INTO cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS t(n_, m_, i)
   WHERE p.oid = to_regprocedure(f) AND m_ = 't';
  IF cols IS DISTINCT FROM 'post_id,ord,media_id,width,height,mime,url' THEN RAISE EXCEPTION 'PROBE FAIL G1: columns %', cols; END IF;
  origin := public.media_cdn_origin();
  IF origin IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G1: media_cdn_origin() is null'; END IF;

  -- fixture (rolled back): a post with ready media by a non-admin author; B another non-admin
  SELECT pm.post_id, p.user_id INTO post, author
    FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
    JOIN public.media_objects mo ON mo.id = pm.media_id
   WHERE NOT public.has_role(p.user_id, 'admin'::public.app_role)
   GROUP BY pm.post_id, p.user_id HAVING bool_and(mo.state = 'ready') LIMIT 1;
  -- A lane with no such post (staging, 2026-10-29: run 40767068051) gets one
  -- INSIDE this transaction: a ready media row attached to a non-admin's post
  -- that has no media graph yet. Rolled back with everything else, so the
  -- PROBE is shaped the same on both lanes and seeds no real data.
  IF post IS NULL THEN
    SELECT p.id, p.user_id INTO post, author
      FROM public.posts p JOIN auth.users u ON u.id = p.user_id
     WHERE NOT public.has_role(p.user_id, 'admin'::public.app_role)
       AND NOT EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = p.id)
     ORDER BY p.created_at LIMIT 1;
    IF post IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G2: no post by a non-admin on this lane to build the fixture on'; END IF;
    -- 'ready' requires derivatives ? 'original' (media_objects_ready_has_derivatives,
    -- 20260814104119); the key names no real object and is rolled back.
    INSERT INTO public.media_objects (owner_id, sha256, width, height, bytes, mime, visibility, state, verified_at, derivatives)
    VALUES (author, decode(md5(random()::text) || md5(random()::text), 'hex'), 2000, 1500, 1000, 'image/webp', 'private', 'ready', now(),
            jsonb_build_object('original', 'post-images/' || author::text || '/posts/probe-0102-fixture-w2000h1500.webp'))
    RETURNING id INTO fx_media;
    INSERT INTO public.post_media (post_id, ord, media_id) VALUES (post, 0, fx_media);
    fixture := 'built in-transaction (lane has no ready media by a non-admin)';
  END IF;
  SELECT pr.id INTO b FROM public.profiles pr JOIN auth.users u ON u.id = pr.id
   WHERE pr.id <> author AND NOT public.has_role(pr.id, 'admin'::public.app_role) ORDER BY pr.created_at LIMIT 1;
  IF b IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G2: need a second non-admin member'; END IF;

  UPDATE public.posts SET privacy = 'private' WHERE id = post;
  IF public.can_view_post(b, author, 'private') THEN RAISE EXCEPTION 'PROBE FAIL G2: B can view an only-me post'; END IF;
  UPDATE public.media_objects mo
     SET derivatives = mo.derivatives
       || jsonb_build_object('p600', public.media_derivative_key(mo.owner_id, mo.id, 'private', 600),
                             'p1080', public.media_derivative_key(mo.owner_id, mo.id, 'private', 1080),
                             'p1440', public.media_derivative_key(mo.owner_id, mo.id, 'private', 1440))
   WHERE mo.id IN (SELECT media_id FROM public.post_media WHERE post_id = post);
  UPDATE public.feature_access SET mode = 'everyone' WHERE feature IN ('media_ladder_feed', 'media_private_photos');

  -- a. author
  PERFORM set_config('request.jwt.claims', json_build_object('sub', author, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', author::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE r.url NOT LIKE origin || '/photo/' || author || '/%' OR r.url LIKE '%/d/%'
                                       OR r.mime <> 'image/webp' OR greatest(r.width, r.height) > 1440)
    INTO n, n_bad FROM public.post_media_resolved_for(ARRAY[post]) r;
  RESET ROLE;
  IF n = 0 OR n % 3 <> 0 OR n_bad <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G2a: author got % rows, % not private-path', n, n_bad; END IF;

  -- b. cross-member
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.post_media_resolved_for(ARRAY[post]);
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G2b: member B got % rows of an only-me post', n; END IF;

  -- c. private switch off
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.feature_access SET mode = 'off' WHERE feature = 'media_private_photos';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', author, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', author::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.post_media_resolved_for(ARRAY[post]);
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G2c: % rows with media_private_photos off', n; END IF;

  -- d. public again, with a complete PUBLIC ladder (seeded here, rolled back) →
  --    rows come back, 3 per slide, every one under /d/, none under /photo/.
  --    Requiring rows keeps this from passing vacuously.
  -- Fixture writes run with NO member claims: with the author's claims still set
  -- (from c), enforce_post_caption_only_update refuses a privacy change
  -- ("Only the caption can be edited", staging run 40944009785).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.feature_access SET mode = 'everyone' WHERE feature = 'media_private_photos';
  UPDATE public.posts SET privacy = 'public' WHERE id = post;
  UPDATE public.media_objects mo
     SET derivatives = mo.derivatives
       || jsonb_build_object('600', public.media_derivative_key(mo.owner_id, mo.id, 'public', 600),
                             '1080', public.media_derivative_key(mo.owner_id, mo.id, 'public', 1080),
                             '1440', public.media_derivative_key(mo.owner_id, mo.id, 'public', 1440))
   WHERE mo.id IN (SELECT media_id FROM public.post_media WHERE post_id = post);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', author, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', author::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE r.url LIKE '%/photo/%' OR r.url NOT LIKE origin || '/post-images/' || author || '/d/%')
    INTO n, n_bad FROM public.post_media_resolved_for(ARRAY[post]) r;
  RESET ROLE;
  IF n = 0 OR n % 3 <> 0 OR n_bad <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL G2d: a public post with a complete public ladder got % rows, % of them private-path or not /d/', n, n_bad;
  END IF;

  -- e. anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM * FROM public.post_media_resolved_for(ARRAY[post]); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G2e: anon executed post_media_resolved_for'; END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'PROBE PASS 20261029_0102 (lane %): switch row present; definer/no anon; author gets /photo/ rows only; member B 0 rows (cross-member); private switch off → 0; public post gets /d/ rows, never /photo/; anon refused; fixture: %',
    current_setting('p32.lane', true), fixture;
END
$g$;

ROLLBACK;
