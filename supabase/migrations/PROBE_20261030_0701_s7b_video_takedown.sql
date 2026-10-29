-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261030_0701 — S7-b video takedown (staging and production)
-- Fixture rows live only inside this transaction (ends in ROLLBACK). Raises on
-- any miss. FAILS before 20261030_0701 (G1: video_takedown does not exist).
--
--   G1 · static: both RPCs SECURITY DEFINER, search_path ''; authenticated
--        yes, anon no; audit table RLS on, no client INSERT/UPDATE/DELETE.
--   G2 · cross-member: member A (the video's owner) and member B are refused
--        video_takedown on A's video and video_report_dismiss on B's report;
--        anon has no EXECUTE.
--   G3 · admin: A's ready video → 'taken_down'; again → 'already' (one audit
--        row, one purge row, one notice). The purge row is A's v1 folder, held
--        ≥ 29 days. A gets the 'video_taken_down' notice. If a post fixture
--        could be made: the post's pending report closes 'video_taken_down',
--        and the video is no longer visible to B through videos RLS.
--        A draft (uploading) video is refused (VID-TD-002).
--   G4 · the audit is append-only even for the migration owner.
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
DECLARE
  _bad text := '';
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.video_takedown(uuid,text,uuid)', 'public.video_report_dismiss(uuid,text)'] LOOP
    IF to_regprocedure(f) IS NULL THEN _bad := _bad || E'\n  ' || f || ' missing'; CONTINUE; END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN _bad := _bad || E'\n  ' || f || ' not SECURITY DEFINER'; END IF;
    IF NOT coalesce((SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = to_regprocedure(f)), false) THEN _bad := _bad || E'\n  ' || f || ' search_path'; END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN _bad := _bad || E'\n  authenticated cannot execute ' || f; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') THEN _bad := _bad || E'\n  anon can execute ' || f; END IF;
  END LOOP;
  IF to_regclass('public.video_takedown_audit') IS NULL THEN
    _bad := _bad || E'\n  video_takedown_audit missing';
  ELSE
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.video_takedown_audit'::regclass) THEN _bad := _bad || E'\n  audit RLS off'; END IF;
    IF has_table_privilege('authenticated', 'public.video_takedown_audit', 'INSERT,UPDATE,DELETE')
       OR has_table_privilege('anon', 'public.video_takedown_audit', 'SELECT,INSERT,UPDATE,DELETE') THEN
      _bad := _bad || E'\n  a client role can write the audit (or anon can read it)';
    END IF;
  END IF;
  IF _bad <> '' THEN RAISE EXCEPTION 'PROBE FAIL G1 (20261030_0701):%', _bad; END IF;
END
$g1$;

DO $g2_g4$
DECLARE
  a uuid; b uuid; adm uuid; va uuid; vd uuid; chk uuid; pid uuid; rid uuid;
  refused int := 0; ok boolean; r text; n int; post_note text := 'post fixture made';
BEGIN
  SELECT p.id INTO a FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.has_role(p.id, 'admin'::public.app_role) ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO b FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.id <> a AND NOT public.has_role(p.id, 'admin'::public.app_role) ORDER BY p.created_at LIMIT 1;
  SELECT ur.user_id INTO adm FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id WHERE ur.role::text = 'admin' LIMIT 1;
  IF a IS NULL OR b IS NULL OR adm IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: need two non-admin members and an admin'; END IF;

  -- A's ready, silent video (the same path the server takes: checking + a not_required check → ready)
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (a, 'post', gen_random_uuid()) RETURNING id INTO va;
  INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio, rendition_bytes, renditions)
    VALUES (va, 1, repeat('a', 64), 1000, 5, false, '{"360p": 1000}', ARRAY['360p']);
  INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check)
    VALUES (va, 1, 'probe', 1, 'not_required', 'off') RETURNING id INTO chk;
  UPDATE public.videos SET state = 'checking' WHERE id = va;
  UPDATE public.videos SET state = 'ready', music_check_id = chk WHERE id = va;
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (a, 'post', gen_random_uuid()) RETURNING id INTO vd;

  BEGIN
    INSERT INTO public.posts (user_id, content, privacy, categories) VALUES (a, 'S7-b probe', 'public', ARRAY['Street']) RETURNING id INTO pid;
    INSERT INTO public.post_videos (post_id, video_id) VALUES (pid, va);
    INSERT INTO public.post_reports (post_id, reporter_id, reason) VALUES (pid, b, 'copyright_music') RETURNING id INTO rid;
  EXCEPTION WHEN OTHERS THEN
    pid := NULL; rid := NULL; post_note := 'post fixture not possible on this lane (' || SQLSTATE || ') — report steps skipped';
  END;

  -- G2 · owner A and member B refused; anon refused
  FOREACH r IN ARRAY ARRAY[a::text, b::text] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', r, true);
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM public.video_takedown(va, 'x', NULL); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
    BEGIN PERFORM public.video_report_dismiss(coalesce(rid, gen_random_uuid()), NULL); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
    RESET ROLE;
  END LOOP;
  IF refused <> 4 THEN RAISE EXCEPTION 'PROBE FAIL G2: members refused % of 4 admin calls', refused; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM public.video_takedown(va, NULL, NULL); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G2: anon executed video_takedown'; END IF;
  IF (SELECT state FROM public.videos WHERE id = va) <> 'ready' THEN RAISE EXCEPTION 'PROBE FAIL G2: a refused call changed the video'; END IF;

  -- G3 · admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', adm::text, true);
  SET LOCAL ROLE authenticated;
  r := public.video_takedown(va, 'probe: copyright', rid);
  IF r <> 'taken_down' THEN RAISE EXCEPTION 'PROBE FAIL G3: takedown answered %', r; END IF;
  r := public.video_takedown(va, 'probe again', NULL);
  IF r <> 'already' THEN RAISE EXCEPTION 'PROBE FAIL G3: a second takedown answered %', r; END IF;
  ok := false;
  BEGIN PERFORM public.video_takedown(vd, NULL, NULL); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G3: a draft video was taken down'; END IF;
  RESET ROLE;

  IF (SELECT state FROM public.videos WHERE id = va) <> 'taken_down' THEN RAISE EXCEPTION 'PROBE FAIL G3: not taken_down'; END IF;
  SELECT count(*) INTO n FROM public.video_takedown_audit WHERE video_id = va AND action = 'taken_down';
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL G3: % audit rows', n; END IF;
  SELECT count(*) INTO n FROM public.video_r2_purge_queue
   WHERE video_id = va AND prefix = 'video/' || a || '/' || va || '/v1/' AND done_at IS NULL AND not_before > now() + interval '29 days';
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL G3: % held purge rows for v1', n; END IF;
  SELECT count(*) INTO n FROM public.user_notifications WHERE user_id = a AND type = 'video_taken_down' AND dedup_key = 'video_taken_down:' || va || ':v1';
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL G3: % owner notices', n; END IF;
  IF rid IS NOT NULL THEN
    IF (SELECT status || '/' || admin_action FROM public.post_reports WHERE id = rid) <> 'reviewed/video_taken_down' THEN
      RAISE EXCEPTION 'PROBE FAIL G3: the report did not close as video_taken_down';
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', b::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.videos WHERE id = va AND state = 'ready';
    RESET ROLE;
    IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL G3: B still sees the video as ready'; END IF;
  END IF;

  -- G4 · append-only
  ok := false;
  BEGIN DELETE FROM public.video_takedown_audit WHERE video_id = va; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G4: the audit row was deleted'; END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'PROBE PASS 20261030_0701 (lane %): owner + other member refused 4/4, anon refused; ready → taken_down once (idempotent), draft refused; v1 files queued with a 30-day hold; owner notified once; audit append-only; %',
    current_setting('p32.lane', true), post_note;
END
$g2_g4$;

ROLLBACK;
