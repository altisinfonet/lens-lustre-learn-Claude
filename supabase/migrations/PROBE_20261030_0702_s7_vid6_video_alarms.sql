-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261030_0702 — S7 VID-6 video alarms (staging and production)
-- Writes fixture rows INSIDE its own transaction and ends in ROLLBACK: nothing
-- it does survives (no alarm row, no setting change, no video). Raises (fails
-- the dispatch) on any miss. FAILS before 20261030_0702 (G1: ops_video_alarms
-- does not exist).
--
--   G0 · lane guard.
--   G1 · static: ops_video_alarms() and ops_video_storage_bytes() exist,
--        SECURITY DEFINER, search_path ''; EXECUTE for no API role (anon,
--        authenticated, service_role, PUBLIC); cron job 'ops-video-alarms'
--        active every 15 min calling only that function; the line is
--        8,000,000,000 bytes.
--   G2 · a member (authenticated) and anon calling ops_video_alarms() are refused.
--   G3 · STORAGE: the measured bytes equal sum(video_versions.total_bytes) +
--        sum(video_sources.source_bytes) (a 1,000-byte fixture version added);
--        line = total + 1 → no open 'video-storage'; line = total → exactly
--        one open alarm whose detail names the total; a second check keeps ONE
--        open row; line = total + 1 → closed.
--   G4 · MUSIC WAIT: a fixture video 'checking' with a pending check 7 h old →
--        'video-music-overdue' opens naming >= 1 video; once that video is
--        'deleted' and no other video is overdue on the lane → closed.
--   G5 · no other alarm key was opened or closed by these checks.
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
  FOREACH f IN ARRAY ARRAY['public.ops_video_alarms()', 'public.ops_video_storage_bytes()'] LOOP
    IF to_regprocedure(f) IS NULL THEN _bad := _bad || E'\n  ' || f || ' missing'; CONTINUE; END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN _bad := _bad || E'\n  ' || f || ' not SECURITY DEFINER'; END IF;
    IF NOT coalesce((SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = to_regprocedure(f)), false) THEN
      _bad := _bad || E'\n  ' || f || ' search_path not ''''';
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR has_function_privilege('service_role', f, 'EXECUTE') THEN
      _bad := _bad || E'\n  an API role can execute ' || f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = to_regprocedure(f) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  PUBLIC can execute ' || f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-video-alarms' AND active
                    AND schedule = '*/15 * * * *' AND command = 'SELECT public.ops_video_alarms()') THEN
    _bad := _bad || E'\n  cron job ops-video-alarms missing, inactive, or not "*/15 * * * *" / "SELECT public.ops_video_alarms()"';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'ops_alarm_settings' AND column_name = 'video_storage_alarm_bytes') THEN
    _bad := _bad || E'\n  ops_alarm_settings.video_storage_alarm_bytes missing';
  ELSIF (SELECT (to_jsonb(s) ->> 'video_storage_alarm_bytes')::bigint FROM public.ops_alarm_settings s WHERE id = 1) IS DISTINCT FROM 8000000000 THEN
    _bad := _bad || E'\n  the alarm line is not 8,000,000,000 bytes';
  END IF;
  IF _bad <> '' THEN RAISE EXCEPTION 'PROBE FAIL G1 (20261030_0702):%', _bad; END IF;
END
$g1$;

DO $g2_g5$
DECLARE
  a uuid; v uuid; vc uuid;
  _others_before jsonb; _others_after jsonb;
  _exp bigint; _got record; _n int; _d jsonb; ok boolean; _real_late bigint;
BEGIN
  SELECT p.id INTO a FROM public.profiles p JOIN auth.users u ON u.id = p.id ORDER BY p.created_at LIMIT 1;
  IF a IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: need one member on the lane for the fixture video'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_array(id, closed_at) ORDER BY id), '[]') INTO _others_before
    FROM public.ops_alarms WHERE alarm_key NOT IN ('video-storage', 'video-music-overdue');

  -- G2 · API roles refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.ops_video_alarms(); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G2: a member executed ops_video_alarms()'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM * FROM public.ops_video_storage_bytes(); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G2: anon executed ops_video_storage_bytes()'; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- fixture (as the migration owner; rolled back): one 1,000-byte version
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (a, 'post', gen_random_uuid()) RETURNING id INTO v;
  INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio, rendition_bytes, renditions)
    VALUES (v, 1, repeat('a', 64), 1000, 10, false, '{"240p": 1000}', ARRAY['240p']);

  -- G3 · storage
  SELECT (SELECT coalesce(sum(total_bytes), 0) FROM public.video_versions)
       + (SELECT coalesce(sum(source_bytes), 0) FROM public.video_sources) INTO _exp;
  SELECT * INTO _got FROM public.ops_video_storage_bytes();
  IF _got.total_bytes IS DISTINCT FROM _exp OR _got.total_bytes <> _got.version_bytes + _got.source_bytes OR _exp < 1000 THEN
    RAISE EXCEPTION 'PROBE FAIL G3: measured % bytes (% + %), expected %', _got.total_bytes, _got.version_bytes, _got.source_bytes, _exp;
  END IF;
  UPDATE public.ops_alarm_settings SET video_storage_alarm_bytes = _exp + 1 WHERE id = 1;
  PERFORM public.ops_video_alarms();
  IF EXISTS (SELECT 1 FROM public.ops_alarms WHERE alarm_key = 'video-storage' AND closed_at IS NULL) THEN
    RAISE EXCEPTION 'PROBE FAIL G3: video-storage open while % bytes < line %', _exp, _exp + 1;
  END IF;
  UPDATE public.ops_alarm_settings SET video_storage_alarm_bytes = _exp WHERE id = 1;
  PERFORM public.ops_video_alarms();
  PERFORM public.ops_video_alarms();
  SELECT count(*), max(detail::text)::jsonb INTO _n, _d FROM public.ops_alarms WHERE alarm_key = 'video-storage' AND closed_at IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL G3: % open video-storage alarms at the line (expected 1)', _n; END IF;
  IF (_d ->> 'total_bytes')::bigint IS DISTINCT FROM _exp OR (_d ->> 'line_bytes')::bigint IS DISTINCT FROM _exp THEN
    RAISE EXCEPTION 'PROBE FAIL G3: alarm detail % does not name total/line %', _d, _exp;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_alarms WHERE alarm_key = 'video-storage' AND closed_at IS NULL
                    AND summary LIKE '[' || current_setting('p32.lane') || '] video storage is % GB%') THEN
    RAISE EXCEPTION 'PROBE FAIL G3: the summary does not name the lane and the size';
  END IF;
  UPDATE public.ops_alarm_settings SET video_storage_alarm_bytes = _exp + 1 WHERE id = 1;
  PERFORM public.ops_video_alarms();
  IF EXISTS (SELECT 1 FROM public.ops_alarms WHERE alarm_key = 'video-storage' AND closed_at IS NULL) THEN
    RAISE EXCEPTION 'PROBE FAIL G3: video-storage did not close below the line';
  END IF;

  -- G4 · music-check wait (fixture video checking, pending check 7 h old)
  UPDATE public.videos SET state = 'checking' WHERE id = v;
  INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, checked_at)
    VALUES (v, 1, 'probe', 1, 'pending', now() - interval '7 hours') RETURNING id INTO vc;
  PERFORM public.ops_video_alarms();
  SELECT detail INTO _d FROM public.ops_alarms WHERE alarm_key = 'video-music-overdue' AND closed_at IS NULL;
  IF _d IS NULL OR (_d ->> 'videos')::int < 1 THEN RAISE EXCEPTION 'PROBE FAIL G4: a 7-hour wait did not open video-music-overdue'; END IF;
  UPDATE public.videos SET state = 'deleted' WHERE id = v;
  SELECT count(*) INTO _real_late FROM public.music_check_overdue(interval '6 hours');
  PERFORM public.ops_video_alarms();
  IF _real_late = 0 AND EXISTS (SELECT 1 FROM public.ops_alarms WHERE alarm_key = 'video-music-overdue' AND closed_at IS NULL) THEN
    RAISE EXCEPTION 'PROBE FAIL G4: video-music-overdue did not close once nothing waited';
  END IF;
  IF _real_late > 0 THEN RAISE NOTICE 'PROBE G4: % real video(s) on this lane wait over 6 h — the close step is not checkable here', _real_late; END IF;

  -- G5 · nothing else touched
  SELECT coalesce(jsonb_agg(jsonb_build_array(id, closed_at) ORDER BY id), '[]') INTO _others_after
    FROM public.ops_alarms WHERE alarm_key NOT IN ('video-storage', 'video-music-overdue');
  IF _others_after IS DISTINCT FROM _others_before THEN RAISE EXCEPTION 'PROBE FAIL G5: another alarm was opened or closed'; END IF;

  RAISE NOTICE 'PROBE PASS 20261030_0702 (lane %): functions closed to every API role; cron every 15 min; line 8e9 bytes; storage measured % bytes (= versions + sources), opens at the line, one row, closes below; 7-hour music wait opens the alarm%; no other alarm touched',
    current_setting('p32.lane', true), _exp - 1000, CASE WHEN _real_late = 0 THEN ' and closes' ELSE ' (close not checkable)' END;
END
$g2_g5$;

ROLLBACK;
