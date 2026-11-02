-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0100 photo camera details (photo plan U1a). ENDS IN ROLLBACK.
-- Reports FIRST: the photo_set_v2 mode, how many members are selected (never
-- who), how many camera rows / hidden flags exist, and the switch key list.
-- A · catalog: both tables exist with RLS on and NOTHING granted to anon /
--     authenticated; the three functions are SECURITY DEFINER search_path="",
--     not executable by PUBLIC; anon cannot execute the two writers,
--     authenticated can execute all three; the switch row is 'off'; the table
--     CHECK refuses a GPS key even from the owner.
-- B · behaviour, on the newest public post of the lane, as simulated members
--     (request.jwt.claims + SET LOCAL ROLE): a GPS key / a location value / an
--     unknown key are REFUSED (003/004); a non-author's write and hide are
--     refused (006); the author's write is refused while the switch is off
--     (007); a hidden post's row is invisible to another member and to anon
--     and visible to its author; un-hidden it is visible again; anon cannot
--     execute the writer. Every row it writes is removed by the ROLLBACK.
-- Before the apply it FAILS at the first missing object (expected).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE
  _mode text; _members int; _post uuid; _author uuid; _x uuid := gen_random_uuid();
  _err text; _n int; _h boolean;
  _good constant jsonb := '[{"ord":0,"camera":"PROBE Camera","lens":"PROBE 50mm","focal_length":50,"aperture":1.8,"shutter":"1/250","iso":200,"taken_at":"2026-11-01T10:00:00"}]';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- ── report ────────────────────────────────────────────────────────────────
  SELECT fa.mode, (SELECT count(*) FROM public.feature_access_members m WHERE m.feature = fa.feature)
    INTO _mode, _members FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  RAISE NOTICE 'photo_set_v2 (lane %): mode=% · selected members=%',
    current_setting('p32.lane'), coalesce(_mode, '(not a switch yet)'), coalesce(_members, 0);
  RAISE NOTICE 'feature_access_feature_check: %', coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.feature_access'::regclass AND conname = 'feature_access_feature_check'), '<none>');

  -- ── A · catalog ───────────────────────────────────────────────────────────
  IF to_regclass('public.post_photo_camera') IS NULL OR to_regclass('public.post_photo_camera_hidden') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL A1: post_photo_camera / post_photo_camera_hidden missing (0100 not applied)';
  END IF;
  RAISE NOTICE 'camera rows=% · hidden flags=%',
    (SELECT count(*) FROM public.post_photo_camera), (SELECT count(*) FROM public.post_photo_camera_hidden);
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.post_photo_camera'::regclass, 'public.post_photo_camera_hidden'::regclass)
              AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'PROBE FAIL A2: RLS is not on for a camera table';
  END IF;
  IF has_table_privilege('anon', 'public.post_photo_camera', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.post_photo_camera', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('anon', 'public.post_photo_camera_hidden', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.post_photo_camera_hidden', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'PROBE FAIL A3: anon/authenticated hold a privilege on a camera table';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.set_post_photo_camera(uuid,jsonb)'),
                       to_regprocedure('public.set_post_photo_camera_hidden(uuid,boolean)'),
                       to_regprocedure('public.post_photo_camera_for(uuid[])'))
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) <> 3 THEN
    RAISE EXCEPTION 'PROBE FAIL A4: a camera function is missing or not SECURITY DEFINER search_path=""';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN ('public.set_post_photo_camera(uuid,jsonb)'::regprocedure,
                              'public.set_post_photo_camera_hidden(uuid,boolean)'::regprocedure,
                              'public.post_photo_camera_for(uuid[])'::regprocedure)
                AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PROBE FAIL A5: PUBLIC can execute a camera function';
  END IF;
  IF has_function_privilege('anon', 'public.set_post_photo_camera(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_post_photo_camera_hidden(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL A6: anon can execute a camera writer';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_post_photo_camera(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_post_photo_camera_hidden(uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.post_photo_camera_for(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.post_photo_camera_for(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL A7: authenticated (all three) / anon (the read) cannot execute as intended';
  END IF;
  IF _mode IS DISTINCT FROM 'off' THEN
    RAISE EXCEPTION 'PROBE FAIL A8: photo_set_v2 row is % (want off)', coalesce(_mode, '<no row>');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feature_access'::regclass
                  AND conname = 'feature_access_feature_check' AND pg_get_constraintdef(oid) ~ '''photo_set_v2''') THEN
    RAISE EXCEPTION 'PROBE FAIL A9: feature_access_feature_check does not allow photo_set_v2';
  END IF;

  -- ── B · behaviour (rolled back) ───────────────────────────────────────────
  SELECT p.id, p.user_id INTO _post, _author FROM public.posts p
   WHERE p.privacy = 'public' ORDER BY p.created_at DESC LIMIT 1;
  IF _post IS NULL THEN RAISE EXCEPTION 'PROBE FAIL B0: this lane has no public post to test on'; END IF;

  BEGIN  -- A10 · the table CHECK refuses a GPS key even from the owner
    INSERT INTO public.post_photo_camera (post_id, ord, info) VALUES (_post, 49, '{"gps_latitude": 22.57}');
    _err := 'no error';
  EXCEPTION WHEN check_violation THEN _err := 'check_violation';
  END;
  IF _err <> 'check_violation' THEN RAISE EXCEPTION 'PROBE FAIL A10: the table accepted a GPS key (%)', _err; END IF;

  -- B1 · a GPS key, a location value, an unknown key — refused, as another member
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _x::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.set_post_photo_camera(_post, '[{"ord":0,"camera":"X","GPSLatitude":22.5726}]');
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-CAM-003%' THEN RAISE EXCEPTION 'PROBE FAIL B1a: a GPS key was not refused with PHOTO-CAM-003 (%)', _err; END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.set_post_photo_camera(_post, '[{"ord":0,"lens":"22.572600, 88.363900"}]');
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-CAM-003%' THEN RAISE EXCEPTION 'PROBE FAIL B1b: a coordinate value was not refused with PHOTO-CAM-003 (%)', _err; END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.set_post_photo_camera(_post, '[{"ord":0,"camera":"X","software":"Y"}]');
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-CAM-004%' THEN RAISE EXCEPTION 'PROBE FAIL B1c: an unknown key was not refused with PHOTO-CAM-004 (%)', _err; END IF;

  -- B2 · a non-author's valid write and hide — refused
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.set_post_photo_camera(_post, _good);
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-CAM-006%' THEN RAISE EXCEPTION 'PROBE FAIL B2a: a non-author write was not refused with PHOTO-CAM-006 (%)', _err; END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.set_post_photo_camera_hidden(_post, true);
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-CAM-006%' THEN RAISE EXCEPTION 'PROBE FAIL B2b: a non-author hide was not refused with PHOTO-CAM-006 (%)', _err; END IF;

  -- B3 · the author, switch off — refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _author, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _author::text, true);
  IF NOT public.feature_allowed('photo_set_v2', _author) THEN
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.set_post_photo_camera(_post, _good);
      _err := 'no error';
    EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
    END;
    RESET ROLE;
    IF _err NOT LIKE 'PHOTO-CAM-007%' THEN RAISE EXCEPTION 'PROBE FAIL B3: the author wrote while photo_set_v2 is off (%)', _err; END IF;
  END IF;

  -- B4 · a row (owner insert, rolled back), hidden by its author through the RPC
  INSERT INTO public.post_photo_camera (post_id, ord, info) VALUES (_post, 0, '{"camera":"PROBE Camera"}')
  ON CONFLICT (post_id, ord) DO UPDATE SET info = EXCLUDED.info;
  SET LOCAL ROLE authenticated;
  PERFORM public.set_post_photo_camera_hidden(_post, true);
  SELECT count(*), bool_and(r.hidden) INTO _n, _h FROM public.post_photo_camera_for(ARRAY[_post]) r WHERE r.ord = 0;
  RESET ROLE;
  IF _n <> 1 OR NOT _h THEN RAISE EXCEPTION 'PROBE FAIL B4a: the author does not see their hidden row (n=%, hidden=%)', _n, _h; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _x::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.post_photo_camera_for(ARRAY[_post]);
  RESET ROLE;
  IF _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL B4b: another member sees % row(s) of a hidden post', _n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO _n FROM public.post_photo_camera_for(ARRAY[_post]);
  RESET ROLE;
  IF _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL B4c: a signed-out viewer sees % row(s) of a hidden post', _n; END IF;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.set_post_photo_camera(_post, _good);
    _err := 'no error';
  EXCEPTION WHEN insufficient_privilege THEN _err := 'insufficient_privilege';
           WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err <> 'insufficient_privilege' THEN RAISE EXCEPTION 'PROBE FAIL B4d: anon reached the writer (%)', _err; END IF;

  -- B5 · un-hidden by the author: another member sees it again
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _author, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _author::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_post_photo_camera_hidden(_post, false);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _x::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), bool_or(r.hidden) INTO _n, _h FROM public.post_photo_camera_for(ARRAY[_post]) r WHERE r.ord = 0;
  RESET ROLE;
  IF _n <> 1 OR _h THEN RAISE EXCEPTION 'PROBE FAIL B5: an un-hidden public row is not visible to another member (n=%, hidden=%)', _n, _h; END IF;

  RAISE NOTICE 'PROBE PASS: 20261110_0100 present; photo_set_v2 off; no GPS; author-only write/hide; hidden rows author-only';
END
$p$;

ROLLBACK;
