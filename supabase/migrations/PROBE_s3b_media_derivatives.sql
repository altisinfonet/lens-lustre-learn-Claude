-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261029_0100 — S3-b derivative ladder RPCs (staging and production)
-- Ends in ROLLBACK: nothing it does survives. Raises (fails the dispatch) on any
-- miss. Prints COUNTS and BOOLEANS only — the Actions log is public.
-- FAILS before 20261029_0100 (G1: the functions do not exist); PASSES after.
--
--   G0 · lane guard.
--   G1 · static: the seven functions exist; the four worker RPCs are SECURITY
--        DEFINER with search_path '' and executable by authenticated, NOT by
--        PUBLIC or anon; the three helpers are not executable by anon or
--        authenticated.
--   G2 · pure: media_rung_dims never upscales and keeps the aspect;
--        media_derivative_key never names a /posts/ original and refuses rung 720.
--   G3 · behaviour, as real members with their JWT claims (SET LOCAL ROLE):
--        a. CROSS-MEMBER: member A (not admin, not converter) is refused (42501)
--           by queue, source, target and record — including for media owned
--           by ANOTHER member B and for A's own media;
--        b. anon cannot execute the queue (42501, no privilege);
--        c. an admin (if the lane has one) reads the queue; if a queue row
--           exists: a wrong key is refused (MEDIA-3005), the right key records
--           once (true) then not again (false), and the original is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $g0$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$g0$;

DO $g1$
DECLARE _bad text := '';
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.media_derivative_queue(integer,uuid)', 'public.media_derivative_source(uuid)',
                           'public.media_derivative_target(uuid,text,integer)', 'public.media_derivative_record(uuid,text,integer,text)'] LOOP
    IF to_regprocedure(f) IS NULL THEN _bad := _bad || E'\n  missing ' || f; CONTINUE; END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN _bad := _bad || E'\n  not SECURITY DEFINER ' || f; END IF;
    IF NOT coalesce((SELECT 'search_path=""' = ANY(proconfig) FROM pg_proc WHERE oid = to_regprocedure(f)), false) THEN _bad := _bad || E'\n  search_path not empty ' || f; END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN _bad := _bad || E'\n  authenticated cannot execute ' || f; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') THEN _bad := _bad || E'\n  anon CAN execute ' || f; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = to_regprocedure(f) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  PUBLIC can execute ' || f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.media_rung_dims(integer,integer,integer)', 'public.media_derivative_key(uuid,uuid,text,integer)',
                           'public.media_derivative_worker_ok()'] LOOP
    IF to_regprocedure(f) IS NULL THEN _bad := _bad || E'\n  missing ' || f; CONTINUE; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      _bad := _bad || E'\n  a client role can execute helper ' || f;
    END IF;
  END LOOP;
  IF _bad <> '' THEN RAISE EXCEPTION 'PROBE FAIL G1 (20261029_0100):%', _bad; END IF;
END
$g1$;

DO $g2$
DECLARE d record; o uuid := '00000000-0000-4000-8000-000000000001'; m uuid := '00000000-0000-4000-8000-000000000002';
BEGIN
  SELECT * INTO d FROM public.media_rung_dims(4000, 3000, 1080);
  IF (d.width, d.height) IS DISTINCT FROM (1080, 810) THEN RAISE EXCEPTION 'PROBE FAIL G2: 4000x3000@1080 → %x%', d.width, d.height; END IF;
  SELECT * INTO d FROM public.media_rung_dims(3000, 4000, 600);
  IF (d.width, d.height) IS DISTINCT FROM (450, 600) THEN RAISE EXCEPTION 'PROBE FAIL G2: 3000x4000@600 → %x%', d.width, d.height; END IF;
  SELECT * INTO d FROM public.media_rung_dims(900, 1200, 1440);
  IF (d.width, d.height) IS DISTINCT FROM (900, 1200) THEN RAISE EXCEPTION 'PROBE FAIL G2: upscaled 900x1200@1440 → %x%', d.width, d.height; END IF;
  IF public.media_derivative_key(o, m, 'public', 1080) <> 'post-images/' || o || '/d/' || m || '/w1080.webp'
     OR public.media_derivative_key(o, m, 'private', 600) <> 'photo/' || o || '/' || m || '/w600.webp'
     OR public.media_derivative_key(o, m, 'public', 720) IS NOT NULL
     OR public.media_derivative_key(o, m, 'other', 600) IS NOT NULL
     OR public.media_derivative_key(o, m, 'public', 600) LIKE '%/posts/%' THEN
    RAISE EXCEPTION 'PROBE FAIL G2: media_derivative_key spelling';
  END IF;
END
$g2$;

DO $g3$
DECLARE
  a uuid; b uuid; adm uuid; a_media uuid; b_media uuid; q record; ok boolean; refused int := 0; n int;
  orig_before text; orig_after text; admin_read text := 'no admin on lane';
BEGIN
  SELECT p.id INTO a FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.has_role(p.id, 'admin'::public.app_role)
     AND NOT EXISTS (SELECT 1 FROM public.video_converter_accounts c WHERE c.user_id = p.id)
   ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO b FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.id <> a AND NOT public.has_role(p.id, 'admin'::public.app_role) ORDER BY p.created_at LIMIT 1;
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G3: need two non-admin members on the lane'; END IF;
  SELECT mo.id INTO a_media FROM public.media_objects mo WHERE mo.owner_id = a LIMIT 1;
  SELECT mo.id INTO b_media FROM public.media_objects mo WHERE mo.owner_id = b LIMIT 1;
  b_media := coalesce(b_media, (SELECT pm.media_id FROM public.post_media pm LIMIT 1), gen_random_uuid());
  a_media := coalesce(a_media, gen_random_uuid());

  -- a. member A: refused everywhere, own media and B's
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM * FROM public.media_derivative_queue(5, NULL); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  BEGIN PERFORM public.media_derivative_source(b_media); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  BEGIN PERFORM public.media_derivative_source(a_media); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  BEGIN PERFORM * FROM public.media_derivative_target(b_media, 'public', 600); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  BEGIN PERFORM public.media_derivative_record(b_media, 'public', 600, 'post-images/x/d/y/w600.webp'); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  BEGIN PERFORM public.media_derivative_record(a_media, 'public', 600, 'post-images/x/d/y/w600.webp'); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  RESET ROLE;
  IF refused <> 6 THEN RAISE EXCEPTION 'PROBE FAIL G3a: member A refused % of 6 worker calls', refused; END IF;

  -- b. anon: no EXECUTE at all
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM * FROM public.media_derivative_queue(5, NULL); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G3b: anon executed the queue'; END IF;

  -- c. admin, if the lane has one
  SELECT ur.user_id INTO adm FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.role = 'admin'::public.app_role LIMIT 1;
  IF adm IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', adm::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.media_derivative_queue(5, NULL);
    admin_read := 'queue rows (first 5 media): ' || n;
    SELECT * INTO q FROM public.media_derivative_queue(1, NULL) LIMIT 1;
    IF q.media_id IS NOT NULL THEN
      RESET ROLE;
      SELECT derivatives->>'original' INTO orig_before FROM public.media_objects WHERE id = q.media_id;
      SET LOCAL ROLE authenticated;
      ok := false;
      BEGIN PERFORM public.media_derivative_record(q.media_id, q.target, q.rung, 'post-images/' || q.media_id || '/posts/x.webp');
      EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
      IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G3c: a wrong key was recorded'; END IF;
      IF NOT public.media_derivative_record(q.media_id, q.target, q.rung,
               (SELECT t.object_key FROM public.media_derivative_target(q.media_id, q.target, q.rung) t)) THEN
        RAISE EXCEPTION 'PROBE FAIL G3c: the right key did not record';
      END IF;
      IF public.media_derivative_record(q.media_id, q.target, q.rung,
               (SELECT t.object_key FROM public.media_derivative_target(q.media_id, q.target, q.rung) t)) THEN
        RAISE EXCEPTION 'PROBE FAIL G3c: the same rung recorded twice';
      END IF;
      RESET ROLE;
      SELECT derivatives->>'original' INTO orig_after FROM public.media_objects WHERE id = q.media_id;
      IF orig_before IS DISTINCT FROM orig_after THEN RAISE EXCEPTION 'PROBE FAIL G3c: the original key changed'; END IF;
      admin_read := admin_read || '; wrong key refused, right key recorded once, original unchanged';
    END IF;
    RESET ROLE;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'PROBE PASS 20261029_0100 (lane %): worker RPCs definer/search_path ''''/no anon/no PUBLIC; helpers closed; rung dims never upscale; keys never name an original; member A refused 6/6 (own and cross-member); anon refused; admin: %',
    current_setting('p32.lane', true), admin_read;
END
$g3$;

ROLLBACK;
