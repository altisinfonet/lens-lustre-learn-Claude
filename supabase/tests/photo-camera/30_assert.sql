-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261110_0100 photo camera details · the gate, as members.
-- Run INSIDE a transaction the runner rolls back. THROWAWAY DATABASE ONLY.
-- Fail-first: before the apply it stops at F-0 (the writer does not exist).
-- ═══════════════════════════════════════════════════════════════════════════

DO $f0$
BEGIN
  IF to_regprocedure('public.set_post_photo_camera(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.post_photo_camera_for(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'FIXTURE FAIL F-0: set_post_photo_camera / post_photo_camera_for do not exist — camera details cannot be stored';
  END IF;
END
$f0$;

-- run one scalar statement as a member (uid) or signed out (uid NULL → anon);
-- returns its value as text, or 'ERR <SQLSTATE> <message>'.
CREATE FUNCTION pg_temp.as_(_uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE _r text;
BEGIN
  BEGIN
    IF _uid IS NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      SET LOCAL ROLE anon;
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE _sql INTO _r;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    _r := 'ERR ' || SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN _r;
END;
$fn$;

CREATE FUNCTION pg_temp.want(_label text, _got text, _like text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF _got IS NULL OR _got NOT LIKE _like THEN
    RAISE EXCEPTION 'FIXTURE FAIL %: got [%] want LIKE [%]', _label, coalesce(_got, '<null>'), _like;
  END IF;
END;
$fn$;

-- members: A author, F A's friend, S a stranger; posts of A: pub / fr / pr
INSERT INTO public.profiles (id) VALUES
  ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000f'), ('00000000-0000-4000-8000-000000000005');
INSERT INTO public.friendships VALUES ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000f', 'accepted');
INSERT INTO public.posts (id, user_id, privacy) VALUES
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a', 'public'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000000a', 'friends'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-00000000000a', 'private');

DO $t$
DECLARE
  a uuid := '00000000-0000-4000-8000-00000000000a';
  f uuid := '00000000-0000-4000-8000-00000000000f';
  s uuid := '00000000-0000-4000-8000-000000000005';
  w text := 'SELECT public.set_post_photo_camera(''00000000-0000-4000-8000-0000000000b1'', %L::jsonb)::text';
  r text := 'SELECT count(*)::text FROM public.post_photo_camera_for(ARRAY[%L::uuid])';
  pub constant text := '00000000-0000-4000-8000-0000000000b1';
  fr  constant text := '00000000-0000-4000-8000-0000000000b2';
  pr  constant text := '00000000-0000-4000-8000-0000000000b3';
  good constant text := '[{"ord":0,"camera":"  Canon EOS R5 ","lens":"RF24-105mm F4 L IS USM","focal_length":35,"aperture":4,"shutter":"1/250","iso":400,"taken_at":"2026-10-31T17:45:12"},'
                         '{"ord":1,"camera":"Canon EOS R5","iso":800,"lens":null,"shutter":""}]';
  big text;
  k text;
  _keys text[];
BEGIN
  -- S1 · the switch: created off, audited; every key the lane had is still allowed
  PERFORM pg_temp.want('S1a switch off', (SELECT mode FROM public.feature_access WHERE feature = 'photo_set_v2'), 'off');
  PERFORM pg_temp.want('S1b audit row', (SELECT (count(*) >= 1)::text FROM public.feature_access_audit
                                         WHERE feature = 'photo_set_v2' AND new_value = 'off' AND old_value IS NULL), 'true');
  _keys := ARRAY['video_posts', 'video_ads', 'copyright_music_check', 'personal_feed', 'media_ladder_feed',
                 'media_private_photos', 'photo_upload_resume', 'photo_set_v2']
           || CASE WHEN current_setting('p32.lane', true) = 'staging' THEN ARRAY['zz_concurrent_unit'] ELSE '{}'::text[] END;
  FOREACH k IN ARRAY _keys LOOP
    PERFORM pg_temp.want('S1c key kept: ' || k, (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'public.feature_access'::regclass AND conname = 'feature_access_feature_check'), '%''' || k || '''%');
  END LOOP;

  -- W0 · switch OFF: the author is refused (007); hiding still works (not gated)
  PERFORM pg_temp.want('W0a off → 007', pg_temp.as_(a, format(w, good)), 'ERR 42501 PHOTO-CAM-007%');
  PERFORM pg_temp.want('W0b hide while off', pg_temp.as_(a, format('SELECT public.set_post_photo_camera_hidden(%L, true)::text', pub)), 'true');
  PERFORM pg_temp.want('W0c unhide while off', pg_temp.as_(a, format('SELECT public.set_post_photo_camera_hidden(%L, false)::text', pub)), 'false');

  -- W1 · selected without A → 007; with A → allowed
  UPDATE public.feature_access SET mode = 'selected' WHERE feature = 'photo_set_v2';
  PERFORM pg_temp.want('W1a selected, not a member → 007', pg_temp.as_(a, format(w, good)), 'ERR 42501 PHOTO-CAM-007%');
  INSERT INTO public.feature_access_members (feature, user_id) VALUES ('photo_set_v2', a);
  PERFORM pg_temp.want('W1b selected member writes 2', pg_temp.as_(a, format(w, good)), '2');
  UPDATE public.feature_access SET mode = 'everyone' WHERE feature = 'photo_set_v2';

  -- W2 · what is stored: trimmed, empty/null dropped, numbers as numbers
  PERFORM pg_temp.want('W2a info ord 0', (SELECT info::text FROM public.post_photo_camera WHERE post_id = pub::uuid AND ord = 0),
    '{"iso": 400, "lens": "RF24-105mm F4 L IS USM", "camera": "Canon EOS R5", "shutter": "1/250", "aperture": 4, "taken_at": "2026-10-31T17:45:12", "focal_length": 35}');
  PERFORM pg_temp.want('W2b info ord 1', (SELECT info::text FROM public.post_photo_camera WHERE post_id = pub::uuid AND ord = 1),
    '{"iso": 800, "camera": "Canon EOS R5"}');

  -- W3 · idempotent; partial overwrite; all-empty item deletes that ord
  PERFORM pg_temp.want('W3a same again', pg_temp.as_(a, format(w, good)), '2');
  PERFORM pg_temp.want('W3b still 2 rows', (SELECT count(*)::text FROM public.post_photo_camera WHERE post_id = pub::uuid), '2');
  PERFORM pg_temp.want('W3c overwrite ord 1', pg_temp.as_(a, format(w, '[{"ord":1,"iso":1600}]')), '1');
  PERFORM pg_temp.want('W3d ord 1 replaced', (SELECT info::text FROM public.post_photo_camera WHERE post_id = pub::uuid AND ord = 1), '{"iso": 1600}');
  PERFORM pg_temp.want('W3e empty item', pg_temp.as_(a, format(w, '[{"ord":1,"camera":null,"lens":"  "}]')), '0');
  PERFORM pg_temp.want('W3f ord 1 gone', (SELECT count(*)::text FROM public.post_photo_camera WHERE post_id = pub::uuid), '1');

  -- G · GPS / location is REFUSED (003), never dropped — and nothing is written
  FOREACH k IN ARRAY ARRAY[
      '[{"ord":0,"GPSLatitude":22.5726}]', '[{"ord":0,"latitude":22.5726}]', '[{"ord":0,"longitude":88.3639}]',
      '[{"ord":0,"lng":88.3639}]', '[{"ord":0,"location":"Kolkata"}]', '[{"ord":0,"geo":"x"}]',
      '[{"ord":0,"gps":{"lat":1,"lon":2}}]', '[{"ord":0,"GPSAltitude":12}]', '[{"ord":0,"coordinates":[1,2]}]',
      '[{"ord":0,"camera":"Canon","lens":"22.572600, 88.363900"}]', '[{"ord":0,"camera":"22°34''N 88°21''E"}]',
      '[{"ord":0,"camera":"ok"},{"ord":1,"camera":"ok","GPSLongitude":88.36}]'] LOOP
    PERFORM pg_temp.want('G ' || k, pg_temp.as_(a, format(w, k)), 'ERR 22023 PHOTO-CAM-003%');
  END LOOP;
  PERFORM pg_temp.want('G nothing written', (SELECT info->>'camera' FROM public.post_photo_camera WHERE post_id = pub::uuid AND ord = 0), 'Canon EOS R5');
  PERFORM pg_temp.want('G no 2nd row', (SELECT count(*)::text FROM public.post_photo_camera WHERE post_id = pub::uuid), '1');

  -- K · whitelist: any other key refused (004)
  FOREACH k IN ARRAY ARRAY['[{"ord":0,"make":"Canon"}]', '[{"ord":0,"camera":"X","Software":"Lightroom"}]', '[{"ord":0,"ORD":1}]'] LOOP
    PERFORM pg_temp.want('K ' || k, pg_temp.as_(a, format(w, k)), 'ERR 22023 PHOTO-CAM-004%');
  END LOOP;

  -- V · value caps and types (005)
  FOREACH k IN ARRAY ARRAY[
      '[{"ord":0,"camera":"' || repeat('x', 101) || '"}]', '[{"ord":0,"lens":50}]', '[{"ord":0,"camera":{"a":1}}]',
      '[{"ord":0,"camera":true}]', '[{"ord":0,"iso":1.5}]', '[{"ord":0,"iso":0}]', '[{"ord":0,"iso":"400"}]',
      '[{"ord":0,"aperture":0.1}]', '[{"ord":0,"aperture":200}]', '[{"ord":0,"focal_length":-1}]',
      '[{"ord":0,"focal_length":"35mm"}]', '[{"ord":0,"shutter":"fast"}]', '[{"ord":0,"shutter":1}]',
      '[{"ord":0,"taken_at":"yesterday"}]', '[{"ord":0,"taken_at":"2026-13-40T10:00:00"}]',
      '[{"ord":0,"camera":"a\u0007b"}]'] LOOP
    PERFORM pg_temp.want('V ' || left(k, 60), pg_temp.as_(a, format(w, k)), 'ERR 22023 PHOTO-CAM-005%');
  END LOOP;
  PERFORM pg_temp.want('V 100 chars ok', pg_temp.as_(a, format(w, '[{"ord":2,"camera":"' || repeat('x', 100) || '"}]')), '1');

  -- P · payload shape (002)
  SELECT '[' || string_agg('{"ord":' || (i % 50) || '}', ',') || ']' INTO big FROM generate_series(0, 50) i;
  FOREACH k IN ARRAY ARRAY['{"ord":0}', '[]', big, '[{"camera":"x"}]', '[{"ord":50,"camera":"x"}]',
                            '[{"ord":1.5,"camera":"x"}]', '[{"ord":"0","camera":"x"}]', '[{"ord":-1}]',
                            '[{"ord":0,"camera":"x"},{"ord":0,"camera":"y"}]', '["x"]', 'null'] LOOP
    PERFORM pg_temp.want('P ' || left(k, 40), pg_temp.as_(a, format(w, k)), 'ERR 22023 PHOTO-CAM-002%');
  END LOOP;

  -- A · only the author; signed-out cannot reach the writers at all
  PERFORM pg_temp.want('A1 stranger write → 006', pg_temp.as_(s, format(w, good)), 'ERR 42501 PHOTO-CAM-006%');
  PERFORM pg_temp.want('A2 friend write → 006', pg_temp.as_(f, format(w, good)), 'ERR 42501 PHOTO-CAM-006%');
  PERFORM pg_temp.want('A3 no such post → 006', pg_temp.as_(a, format('SELECT public.set_post_photo_camera(%L, %L::jsonb)::text', gen_random_uuid(), good)), 'ERR 42501 PHOTO-CAM-006%');
  PERFORM pg_temp.want('A4 anon write', pg_temp.as_(NULL, format(w, good)), 'ERR 42501 permission denied for function set_post_photo_camera%');
  PERFORM pg_temp.want('A5 anon hide', pg_temp.as_(NULL, format('SELECT public.set_post_photo_camera_hidden(%L, true)::text', pub)), 'ERR 42501 permission denied for function set_post_photo_camera_hidden%');
  PERFORM pg_temp.want('A6 stranger hide → 006', pg_temp.as_(s, format('SELECT public.set_post_photo_camera_hidden(%L, true)::text', pub)), 'ERR 42501 PHOTO-CAM-006%');
  PERFORM pg_temp.want('A7 no direct SELECT', pg_temp.as_(s, 'SELECT count(*)::text FROM public.post_photo_camera'), 'ERR 42501 permission denied%');
  PERFORM pg_temp.want('A8 no direct INSERT', pg_temp.as_(a, format('INSERT INTO public.post_photo_camera (post_id, ord, info) VALUES (%L, 9, ''{"iso":1}'') RETURNING 1', pub)), 'ERR 42501 permission denied%');
  PERFORM pg_temp.want('A9 no direct hide row', pg_temp.as_(s, format('INSERT INTO public.post_photo_camera_hidden (post_id) VALUES (%L) RETURNING 1', pub)), 'ERR 42501 permission denied%');
  PERFORM pg_temp.want('A10 anon no SELECT', pg_temp.as_(NULL, 'SELECT count(*)::text FROM public.post_photo_camera_hidden'), 'ERR 42501 permission denied%');

  -- R · reads follow can_view_post (pub: 2 rows now — ord 0 and ord 2)
  PERFORM pg_temp.want('R1 stranger public', pg_temp.as_(s, format(r, pub)), '2');
  PERFORM pg_temp.want('R2 anon public', pg_temp.as_(NULL, format(r, pub)), '2');
  PERFORM pg_temp.want('R3 write friends post', pg_temp.as_(a, format('SELECT public.set_post_photo_camera(%L, ''[{"ord":0,"iso":100}]'')::text', fr)), '1');
  PERFORM pg_temp.want('R4 write private post', pg_temp.as_(a, format('SELECT public.set_post_photo_camera(%L, ''[{"ord":0,"iso":100}]'')::text', pr)), '1');
  PERFORM pg_temp.want('R5 friend sees friends post', pg_temp.as_(f, format(r, fr)), '1');
  PERFORM pg_temp.want('R6 stranger no friends post', pg_temp.as_(s, format(r, fr)), '0');
  PERFORM pg_temp.want('R7 anon no friends post', pg_temp.as_(NULL, format(r, fr)), '0');
  PERFORM pg_temp.want('R8 friend no private post', pg_temp.as_(f, format(r, pr)), '0');
  PERFORM pg_temp.want('R9 author sees private post', pg_temp.as_(a, format(r, pr)), '1');
  PERFORM pg_temp.want('R10 cap 51 → 008', pg_temp.as_(s, format('SELECT count(*)::text FROM public.post_photo_camera_for(%L::uuid[])',
    (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 51)))), 'ERR 22023 PHOTO-CAM-008%');
  PERFORM pg_temp.want('R11 empty array', pg_temp.as_(s, 'SELECT count(*)::text FROM public.post_photo_camera_for(''{}''::uuid[])'), '0');
  PERFORM pg_temp.want('R12 null', pg_temp.as_(s, 'SELECT count(*)::text FROM public.post_photo_camera_for(NULL)'), '0');

  -- H · hide: the author still sees (hidden=true); nobody else does; un-hide restores
  PERFORM pg_temp.want('H1 author hides', pg_temp.as_(a, format('SELECT public.set_post_photo_camera_hidden(%L, true)::text', pub)), 'true');
  PERFORM pg_temp.want('H2 hide twice ok', pg_temp.as_(a, format('SELECT public.set_post_photo_camera_hidden(%L, true)::text', pub)), 'true');
  PERFORM pg_temp.want('H3 stranger sees none', pg_temp.as_(s, format(r, pub)), '0');
  PERFORM pg_temp.want('H4 friend sees none', pg_temp.as_(f, format(r, pub)), '0');
  PERFORM pg_temp.want('H5 anon sees none', pg_temp.as_(NULL, format(r, pub)), '0');
  PERFORM pg_temp.want('H6 author sees hidden rows', pg_temp.as_(a,
    format('SELECT count(*)::text FROM public.post_photo_camera_for(ARRAY[%L::uuid]) x WHERE x.hidden', pub)), '2');
  PERFORM pg_temp.want('H7 re-save keeps hidden', pg_temp.as_(a, format(w, '[{"ord":0,"iso":3200}]')), '1');
  PERFORM pg_temp.want('H8 still hidden', pg_temp.as_(s, format(r, pub)), '0');
  PERFORM pg_temp.want('H9 author un-hides', pg_temp.as_(a, format('SELECT public.set_post_photo_camera_hidden(%L, false)::text', pub)), 'false');
  PERFORM pg_temp.want('H10 stranger sees again', pg_temp.as_(s,
    format('SELECT count(*)::text FROM public.post_photo_camera_for(ARRAY[%L::uuid]) x WHERE NOT x.hidden', pub)), '2');

  -- T · the table itself refuses a location key, even from the owner
  BEGIN
    INSERT INTO public.post_photo_camera (post_id, ord, info) VALUES (pub::uuid, 9, '{"camera":"x","gps_latitude":22.5}');
    RAISE EXCEPTION 'FIXTURE FAIL T1: the table accepted a GPS key';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- D · deleting the post deletes its details and its hidden flag
  PERFORM pg_temp.want('D0 hide fr', pg_temp.as_(a, format('SELECT public.set_post_photo_camera_hidden(%L, true)::text', fr)), 'true');
  DELETE FROM public.posts WHERE id = fr::uuid;
  PERFORM pg_temp.want('D1 rows cascade', (SELECT count(*)::text FROM public.post_photo_camera WHERE post_id = fr::uuid), '0');
  PERFORM pg_temp.want('D2 flag cascades', (SELECT count(*)::text FROM public.post_photo_camera_hidden WHERE post_id = fr::uuid), '0');

  -- O · switched back off: writes refused again, existing rows still readable
  UPDATE public.feature_access SET mode = 'off' WHERE feature = 'photo_set_v2';
  PERFORM pg_temp.want('O1 off again → 007', pg_temp.as_(a, format(w, good)), 'ERR 42501 PHOTO-CAM-007%');

  RAISE NOTICE 'FIXTURE PASS: photo camera details — switch, whitelist, GPS refusal, caps, author-only, can_view_post, hide, cascade (lane %)',
    current_setting('p32.lane', true);
END
$t$;
