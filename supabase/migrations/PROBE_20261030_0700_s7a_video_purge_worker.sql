-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261030_0700 — S7-a video purge worker (staging and production)
-- Writes fixture rows INSIDE its own transaction and ends in ROLLBACK: nothing
-- it does survives. Raises (fails the dispatch) on any miss. FAILS before
-- 20261030_0700 (G1: video_purge_claim does not exist).
--
--   G0 · lane guard.
--   G1 · static: claim/done SECURITY DEFINER, search_path ''; EXECUTE for
--        authenticated, not anon / PUBLIC; the rule, the gate, the sweep and the
--        trigger function executable by no API role; trigger + cron job present.
--   G2 · cross-member: member A (not admin, not converter) is refused claim and
--        done — on a row naming A's own video and on one naming B's; anon has
--        no EXECUTE.
--   G3 · as an admin (real JWT role):
--        QUEUED → DELETED: a row for a video that no longer exists is handed
--          out, leased; done(…, 7) closes it 'deleted' with 7; done again →
--          'already'; it is not handed out again.
--        REFERENCED → KEPT: a whole-video row for A's live video closes
--          'kept_referenced' and is never handed out; a version row of a
--          music_blocked video waits a day; once that video is 'deleted' the
--          same row is handed out.
--        a row naming another member's folder closes 'bad_prefix';
--        a row not yet due (not_before tomorrow) is not handed out;
--        done(…, error) releases the lease and keeps the error.
--   G4 · deleting a video row queues 'video/<o>/<v>/' exactly once.
--   G5 · the sweep: A's unlinked music_blocked video, 31 days on, → 'deleted';
--        a _keep under 30 days and an _as_of in the past are refused.
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
  FOREACH f IN ARRAY ARRAY['public.video_purge_claim(integer)', 'public.video_purge_done(bigint,integer,text)'] LOOP
    IF to_regprocedure(f) IS NULL THEN _bad := _bad || E'\n  ' || f || ' missing'; CONTINUE; END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN _bad := _bad || E'\n  ' || f || ' not SECURITY DEFINER'; END IF;
    IF NOT coalesce((SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = to_regprocedure(f)), false) THEN _bad := _bad || E'\n  ' || f || ' search_path not '''''; END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN _bad := _bad || E'\n  authenticated cannot execute ' || f; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') THEN _bad := _bad || E'\n  anon can execute ' || f; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.video_purge_referenced(uuid,uuid,text)', 'public.video_purge_worker_ok()',
                           'public.video_orphan_sweep(interval,integer,timestamptz)', 'public.tg_videos_queue_purge()'] LOOP
    IF to_regprocedure(f) IS NULL THEN _bad := _bad || E'\n  ' || f || ' missing'; CONTINUE; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR has_function_privilege('service_role', f, 'EXECUTE') THEN
      _bad := _bad || E'\n  an API role can execute ' || f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tg_videos_queue_purge' AND tgrelid = 'public.videos'::regclass) THEN
    _bad := _bad || E'\n  trigger tg_videos_queue_purge missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'video-orphan-sweep' AND active) THEN
    _bad := _bad || E'\n  cron job video-orphan-sweep missing or inactive';
  END IF;
  IF _bad <> '' THEN RAISE EXCEPTION 'PROBE FAIL G1 (20261030_0700):%', _bad; END IF;
END
$g1$;

DO $g2_g5$
DECLARE
  a uuid; b uuid; adm uuid;
  va uuid; vb uuid; vgone uuid := gen_random_uuid();
  q_gone bigint; q_live bigint; q_ver bigint; q_bad bigint; q_later bigint; q_err bigint;
  refused int := 0; ok boolean; r text; got bigint[]; n int; o record;
BEGIN
  SELECT p.id INTO a FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.has_role(p.id, 'admin'::public.app_role)
     AND NOT EXISTS (SELECT 1 FROM public.video_converter_accounts c WHERE c.user_id = p.id)
   ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO b FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.id <> a AND NOT public.has_role(p.id, 'admin'::public.app_role) ORDER BY p.created_at LIMIT 1;
  SELECT ur.user_id INTO adm FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
   WHERE ur.role::text = 'admin' LIMIT 1;
  IF a IS NULL OR b IS NULL OR adm IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: need two non-admin members and an admin on the lane'; END IF;

  -- fixtures (as the migration owner; rolled back): A's and B's videos, A's to music_blocked
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (a, 'post', gen_random_uuid()) RETURNING id INTO va;
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (b, 'post', gen_random_uuid()) RETURNING id INTO vb;
  UPDATE public.videos SET state = 'checking' WHERE id = va;
  UPDATE public.videos SET state = 'music_blocked' WHERE id = va;
  INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix, not_before)
    VALUES (vgone, a, 'video/' || a || '/' || vgone || '/', '2000-01-01') RETURNING id INTO q_gone;
  INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix, not_before)
    VALUES (va, a, 'video/' || a || '/' || va || '/', '2000-01-01') RETURNING id INTO q_live;
  INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix, not_before)
    VALUES (va, a, 'video/' || a || '/' || va || '/v1/', '2000-01-01') RETURNING id INTO q_ver;
  INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix, not_before)   -- names B's folder
    VALUES (gen_random_uuid(), a, 'video/' || b || '/' || vb || '/', '2000-01-01') RETURNING id INTO q_bad;
  INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix, not_before)
    VALUES (gen_random_uuid(), b, 'video/' || b || '/' || gen_random_uuid() || '/', now() + interval '1 day') RETURNING id INTO q_later;
  INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix, not_before)
    VALUES (gen_random_uuid(), b, 'video/' || b || '/' || gen_random_uuid() || '/', '2000-01-01') RETURNING id INTO q_err;
  UPDATE public.video_r2_purge_queue SET video_id = substring(prefix from 'video/[^/]+/([^/]+)/')::uuid WHERE id IN (q_later, q_err);

  -- G2 · member A, own and cross-member; anon
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM * FROM public.video_purge_claim(5); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  BEGIN PERFORM public.video_purge_done(q_live, 0, NULL); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  BEGIN PERFORM public.video_purge_done(q_err, 0, NULL); EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1; END;
  RESET ROLE;
  IF refused <> 3 THEN RAISE EXCEPTION 'PROBE FAIL G2: member A refused % of 3 purge calls', refused; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN PERFORM * FROM public.video_purge_claim(5); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G2: anon executed video_purge_claim'; END IF;

  -- G3 · admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', adm::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(c.id) INTO got FROM public.video_purge_claim(50) c;
  got := coalesce(got, '{}');
  IF NOT (q_gone = ANY (got)) THEN RAISE EXCEPTION 'PROBE FAIL G3: the queued row of a gone video was not handed out'; END IF;
  IF q_live = ANY (got) OR q_ver = ANY (got) OR q_bad = ANY (got) OR q_later = ANY (got) THEN
    RAISE EXCEPTION 'PROBE FAIL G3: a referenced, foreign or not-yet-due row was handed out';
  END IF;
  IF NOT (q_err = ANY (got)) THEN RAISE EXCEPTION 'PROBE FAIL G3: the error-case row was not handed out'; END IF;
  r := public.video_purge_done(q_gone, 7, NULL);
  IF r <> 'deleted' THEN RAISE EXCEPTION 'PROBE FAIL G3: done answered %', r; END IF;
  r := public.video_purge_done(q_gone, 7, NULL);
  IF r <> 'already' THEN RAISE EXCEPTION 'PROBE FAIL G3: a second done answered %', r; END IF;
  r := public.video_purge_done(q_err, 0, 'R2 list failed: 500 <script>');
  IF r <> 'retry' THEN RAISE EXCEPTION 'PROBE FAIL G3: an error answered %', r; END IF;
  RESET ROLE;
  SELECT outcome, objects_deleted, done_at IS NOT NULL AS d INTO o FROM public.video_r2_purge_queue WHERE id = q_gone;
  IF o.outcome IS DISTINCT FROM 'deleted' OR o.objects_deleted IS DISTINCT FROM 7 OR NOT o.d THEN RAISE EXCEPTION 'PROBE FAIL G3: queued → deleted not recorded'; END IF;
  SELECT outcome INTO r FROM public.video_r2_purge_queue WHERE id = q_live;
  IF r IS DISTINCT FROM 'kept_referenced' THEN RAISE EXCEPTION 'PROBE FAIL G3: referenced whole video closed as %', r; END IF;
  SELECT outcome INTO r FROM public.video_r2_purge_queue WHERE id = q_bad;
  IF r IS DISTINCT FROM 'bad_prefix' THEN RAISE EXCEPTION 'PROBE FAIL G3: a foreign folder closed as %', r; END IF;
  IF (SELECT not_before < now() + interval '23 hours' OR done_at IS NOT NULL FROM public.video_r2_purge_queue WHERE id = q_ver) THEN
    RAISE EXCEPTION 'PROBE FAIL G3: a referenced version row did not wait a day';
  END IF;
  IF (SELECT claimed_until IS NOT NULL OR last_error IS NULL OR last_error ~ '[<>]' FROM public.video_r2_purge_queue WHERE id = q_err) THEN
    RAISE EXCEPTION 'PROBE FAIL G3: an error did not release the lease with a clean message';
  END IF;

  -- the version row goes once its video is deleted
  UPDATE public.videos SET state = 'deleted' WHERE id = va;
  UPDATE public.video_r2_purge_queue SET not_before = '2000-01-01' WHERE id = q_ver;
  SET LOCAL ROLE authenticated;
  SELECT array_agg(c.id) INTO got FROM public.video_purge_claim(50) c;
  RESET ROLE;
  IF NOT (q_ver = ANY (coalesce(got, '{}'))) THEN RAISE EXCEPTION 'PROBE FAIL G3: the version row of a deleted video was not handed out'; END IF;
  IF q_gone = ANY (coalesce(got, '{}')) OR q_live = ANY (coalesce(got, '{}')) THEN RAISE EXCEPTION 'PROBE FAIL G3: a closed row was handed out again'; END IF;

  -- G4 · a deleted video row queues its folder once
  PERFORM set_config('vid.purge', 'on', true);
  DELETE FROM public.videos WHERE id = vb;
  PERFORM set_config('vid.purge', 'off', true);
  SELECT count(*) INTO n FROM public.video_r2_purge_queue WHERE video_id = vb AND prefix = 'video/' || b || '/' || vb || '/' AND done_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL G4: deleting a video queued % rows', n; END IF;

  -- G5 · the sweep (A gets a fresh unlinked music_blocked video)
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (a, 'post', gen_random_uuid()) RETURNING id INTO va;
  UPDATE public.videos SET state = 'checking' WHERE id = va;
  UPDATE public.videos SET state = 'music_blocked' WHERE id = va;
  PERFORM public.video_orphan_sweep(interval '30 days', 100000, now());
  IF (SELECT state FROM public.videos WHERE id = va) <> 'music_blocked' THEN RAISE EXCEPTION 'PROBE FAIL G5: a fresh video was swept'; END IF;
  PERFORM public.video_orphan_sweep(interval '30 days', 100000, now() + interval '31 days');
  IF (SELECT state FROM public.videos WHERE id = va) <> 'deleted' THEN RAISE EXCEPTION 'PROBE FAIL G5: an unlinked video 31 days on was not swept'; END IF;
  ok := false;
  BEGIN PERFORM public.video_orphan_sweep(interval '29 days', 10, now()); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G5: a 29-day keep was accepted'; END IF;
  ok := false;
  BEGIN PERFORM public.video_orphan_sweep(interval '30 days', 10, now() - interval '1 day'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'PROBE FAIL G5: an _as_of in the past was accepted'; END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'PROBE PASS 20261030_0700 (lane %): grants closed; member A refused 3/3 (own and cross-member), anon refused; queued → deleted (7 objects, idempotent); referenced → kept; version row waits, then goes once the video is deleted; foreign folder → bad_prefix; not-due held; error releases the lease; deleted video queued once; sweep 30-day rule',
    current_setting('p32.lane', true);
END
$g2_g5$;

ROLLBACK;
