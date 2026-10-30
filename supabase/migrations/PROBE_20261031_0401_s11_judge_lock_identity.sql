-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0401 — judging locks act only for the signed-in judge
-- (staging and production). Re-cut of PR #276's body fix.
-- Writes fixture rows INSIDE its own transaction and ends in ROLLBACK:
-- nothing survives. Prints COUNTS and BOOLEANS only (the Actions log is
-- public): no member id, no row data.
-- FAILS before 0401 (a plain member can release / extend / take a lock in
-- another judge's name); PASSES after.
--
-- FIXTURE (built the same way on both lanes, rolled back): member A = an
-- existing account holding neither judge nor admin; "judge" J = a random
-- uuid (judge_entry_locks.judge_id has no foreign key); entry E = any
-- existing competition entry; photo index 9001/9002 (never used by the app).
-- For the positive control A is given the judge role in this transaction.
-- user_roles.role is compared as text (staging text, production app_role).
--
--   G0 · lane asserted.
--   G1 · static: all three bodies check auth.uid(); md5 of each live body
--        (whitespace-normalised) vs the pre-fix git body, printed as booleans
--        so the apply's drift check can be trusted.
--   G2 · as A (no judge role): release J's lock, heartbeat J's lock, acquire
--        in J's name → each REFUSED (42501) and J's lock untouched.
--   G3 · as anon: release J's lock → refused.
--   G4 · control, as A WITH the judge role, acting as A: acquire → acquired,
--        heartbeat → true, release → true (real judges are unaffected).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  _bad   text := '';
  _info  text := '';
  a      uuid;
  j      uuid := gen_random_uuid();
  e      uuid;
  ok     boolean;
  res    jsonb;
  refused boolean;
  n      integer;
  pre_md5 constant jsonb := '{"acquire_judge_lock":"71069d4a19a3defd0bec06969efd76bb","heartbeat_judge_lock":"3cc9bc3e203a01fb91497aa52275cbf9","release_judge_lock":"672c3b49b8e874b5fd75d0f79ce8f279"}';
  r record;
BEGIN
  -- G0
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  -- G1 · static
  FOR r IN
    SELECT p.proname, p.prosrc,
           md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) AS h
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('acquire_judge_lock', 'heartbeat_judge_lock', 'release_judge_lock')
  LOOP
    _info := _info || format(' %s(body_is_pre_fix_git=%s)', r.proname, r.h = pre_md5 ->> r.proname);
    IF r.prosrc !~ 'auth\.uid\(\)' THEN
      _bad := _bad || format(' G1(%s does not check auth.uid())', r.proname);
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('acquire_judge_lock', 'heartbeat_judge_lock', 'release_judge_lock');
  IF n <> 3 THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0401 G1: expected one overload each of the 3 lock functions, found %', n;
  END IF;

  -- Fixture
  SELECT u.id INTO a FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = u.id AND ur.role::text IN ('judge', 'admin'))
   ORDER BY u.created_at LIMIT 1;
  SELECT ce.id INTO e FROM public.competition_entries ce ORDER BY ce.created_at LIMIT 1;
  IF a IS NULL OR e IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0401: fixture impossible on this lane (non-judge member found=%, entry found=%)', a IS NOT NULL, e IS NOT NULL;
  END IF;
  DELETE FROM public.judge_entry_locks WHERE entry_id = e AND photo_index IN (9001, 9002);
  INSERT INTO public.judge_entry_locks (entry_id, photo_index, judge_id, expires_at)
  VALUES (e, 9001, j, now() + interval '5 minutes');

  -- G2 · as A, no judge role
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    ok := public.release_judge_lock(e, 9001, j);
    refused := false;
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN _bad := _bad || format(' G2a(member released another judge''s lock: %s)', ok); END IF;

  BEGIN
    ok := public.heartbeat_judge_lock(e, 9001, j, 60);
    refused := false;
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN _bad := _bad || format(' G2b(member extended another judge''s lock: %s)', ok); END IF;

  BEGIN
    res := public.acquire_judge_lock(e, 9002, j, 5);
    refused := false;
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN _bad := _bad || format(' G2c(member took a lock in another judge''s name: acquired=%s)', res ->> 'acquired'); END IF;

  BEGIN
    res := public.acquire_judge_lock(e, 9002, a, 5);
    refused := false;
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN _bad := _bad || format(' G2d(non-judge took a lock as themselves: acquired=%s)', res ->> 'acquired'); END IF;

  RESET ROLE;
  SELECT count(*) INTO n FROM public.judge_entry_locks
   WHERE entry_id = e AND photo_index = 9001 AND judge_id = j AND expires_at < now() + interval '10 minutes';
  IF n <> 1 THEN _bad := _bad || ' G2e(J''s lock was removed or extended)'; END IF;
  DELETE FROM public.judge_entry_locks WHERE entry_id = e AND photo_index = 9002;

  -- G3 · anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    ok := public.release_judge_lock(e, 9001, j);
    refused := false;
  EXCEPTION WHEN insufficient_privilege OR invalid_authorization_specification THEN refused := true;
  END;
  IF NOT refused THEN _bad := _bad || ' G3(anon released a lock)'; END IF;
  RESET ROLE;

  -- G4 · control: A as a judge, acting as A
  INSERT INTO public.user_roles (user_id, role) VALUES (a, 'judge');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    res := public.acquire_judge_lock(e, 9002, a, 5);
    IF coalesce((res ->> 'acquired')::boolean, false) IS NOT TRUE THEN _bad := _bad || ' G4a(judge could not take own lock)'; END IF;
    IF NOT public.heartbeat_judge_lock(e, 9002, a, 5) THEN _bad := _bad || ' G4b(judge could not extend own lock)'; END IF;
    IF NOT public.release_judge_lock(e, 9002, a) THEN _bad := _bad || ' G4c(judge could not release own lock)'; END IF;
  EXCEPTION WHEN OTHERS THEN
    _bad := _bad || format(' G4(judge acting as self was refused: %s)', SQLSTATE);
  END;
  RESET ROLE;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0401 (lane %):%  | info:%', current_setting('p32.lane'), _bad, _info;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0401 (lane %): member/anon refused on release, heartbeat, acquire-as-other, acquire-as-non-judge; judge acting as self unaffected | info:%',
    current_setting('p32.lane'), _info;
END
$probe$;

ROLLBACK;
