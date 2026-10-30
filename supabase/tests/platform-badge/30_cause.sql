-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · Unit A · the cause, as assertions. Plays a member's session the
-- way the client does it, against the REAL server writers (installed by the
-- runner verbatim: record_session_end + backfill_last_seen from 20260920_0001,
-- the F-P1-6 trigger from 20261029_0002, record_activity_minute in 10_shape).
--
-- "The client's session-start call" is record_session_platform(_platform)
-- when that function exists — exactly what useSessionEnd.ts calls since
-- Unit A (pinned by src/components/__tests__/AdminUsersActivity.test.ts).
-- Before 20261102_0102 there is no such call, and these assertions are RED
-- for the reason named in each message. That is the proof of the cause.
-- ═══════════════════════════════════════════════════════════════════════════
DO $c$
DECLARE
  w  uuid := '00000000-0000-0000-0000-00000000a001';  -- web member, new
  a  uuid := '00000000-0000-0000-0000-00000000a002';  -- app member, new, leaves inside 60 s
  x  uuid := '00000000-0000-0000-0000-00000000a003';  -- web member opens the app
  o  uuid := '00000000-0000-0000-0000-00000000a004';  -- old member, nothing recorded
  t  uuid := '00000000-0000-0000-0000-00000000a005';  -- same platform, many starts
  has_start boolean := to_regprocedure('public.record_session_platform(text)') IS NOT NULL;
  v text; xmin_before xid; xmin_after xid; caught text;

BEGIN
  INSERT INTO auth.users (id, created_at) VALUES
    (w, now() - interval '40 seconds'), (a, now() - interval '30 seconds'),
    (x, now() - interval '30 days'), (o, '2026-07-01'), (t, now() - interval '30 days');
  -- profiles rows as handle_new_user leaves them: last_active_at = its DEFAULT
  -- now() at sign-up (20260330142754:3), last_platform NULL.
  INSERT INTO public.profiles (id, last_active_at, last_platform) VALUES
    (w, now() - interval '40 seconds', NULL),
    (a, now() - interval '30 seconds', NULL),
    (x, now() - interval '2 days', 'web'),
    (o, '2026-07-20 10:11:12.345', NULL),
    (t, now() - interval '2 days', 'app');

  -- ── W · a new web member, active for under a minute ────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF has_start THEN PERFORM public.record_session_platform('web'); END IF;   -- session start (client)
  PERFORM public.record_activity_minute('feed', true);                       -- heartbeat (client)
  RESET ROLE;
  SELECT last_platform INTO v FROM public.profiles WHERE id = w;
  IF v IS DISTINCT FROM 'web' THEN
    RAISE EXCEPTION 'FIXTURE FAIL CAUSE-1: a member using the website for under a minute has last_platform=% — nothing writes it while a session is running; record_session_end (the only writer) runs when the session ENDS', coalesce(v, 'NULL');
  END IF;

  -- ── A · a new app member who leaves inside 60 s of sign-up ─────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF has_start THEN PERFORM public.record_session_platform('app'); END IF;
  PERFORM public.record_activity_minute('home', true);
  PERFORM public.record_session_end('app');                                  -- app backgrounded (picker)
  RESET ROLE;
  -- the backfill job later (a heartbeat minute 15 min after sign-up)
  INSERT INTO public.member_activity_minutes (user_id, minute_bucket, surface)
  VALUES (a, date_trunc('minute', now()) + interval '15 minutes', 'public') ON CONFLICT DO NOTHING;
  PERFORM public.backfill_last_seen();
  SELECT last_platform INTO v FROM public.profiles WHERE id = a;
  IF v IS DISTINCT FROM 'app' THEN
    RAISE EXCEPTION 'FIXTURE FAIL CAUSE-2: a new app member whose session ended inside 60 s of sign-up has last_platform=% — the sign-up DEFAULT now() makes record_session_end''s 60-second rule match no row, and backfill_last_seen moves only the time', coalesce(v, 'NULL');
  END IF;

  -- ── X · switching: a web member opens the app → App within a minute ────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF has_start THEN PERFORM public.record_session_platform('app'); END IF;
  PERFORM public.record_activity_minute('feed', false);
  RESET ROLE;
  SELECT last_platform INTO v FROM public.profiles WHERE id = x;
  IF v IS DISTINCT FROM 'app' THEN
    RAISE EXCEPTION 'FIXTURE FAIL CAUSE-3: a web member now using the app still shows %, until the app session ends', coalesce(v, 'NULL');
  END IF;

  -- ── O · nothing is invented for a member with no recorded session ──────
  IF (SELECT last_platform FROM public.profiles WHERE id = o) IS NOT NULL THEN
    RAISE EXCEPTION 'FIXTURE FAIL O1: a platform was written for a member with no recorded session';
  END IF;

  -- ── T · the same platform again writes no new row version ──────────────
  IF has_start THEN
    SELECT xmin INTO xmin_before FROM public.profiles WHERE id = t;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.record_session_platform('app');
    PERFORM public.record_session_platform('app');
    RESET ROLE;
    SELECT xmin INTO xmin_after FROM public.profiles WHERE id = t;
    IF xmin_after IS DISTINCT FROM xmin_before THEN
      RAISE EXCEPTION 'FIXTURE FAIL T1: an unchanged platform still wrote a profiles row version';
    END IF;

    -- ── P · refusals: bad value 22023; signed out no-op; anon no EXECUTE ──
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.record_session_platform('ios');
      caught := 'accepted';
    EXCEPTION WHEN invalid_parameter_value THEN caught := '22023';
    END;
    RESET ROLE;
    IF caught <> '22023' THEN RAISE EXCEPTION 'FIXTURE FAIL P1: a bad platform was %', caught; END IF;
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE authenticated;
    PERFORM public.record_session_platform('web');   -- signed out: no row, no error
    RESET ROLE;
    SET LOCAL ROLE anon;
    BEGIN
      PERFORM public.record_session_platform('web');
      caught := 'ran';
    EXCEPTION WHEN insufficient_privilege THEN caught := 'refused';
    END;
    RESET ROLE;
    IF caught <> 'refused' THEN RAISE EXCEPTION 'FIXTURE FAIL P2: anon can call record_session_platform'; END IF;
    -- own row only: o is untouched by everyone else's calls
    IF (SELECT last_platform FROM public.profiles WHERE id = o) IS NOT NULL THEN
      RAISE EXCEPTION 'FIXTURE FAIL P3: another member''s row was written';
    END IF;
  END IF;

  RAISE NOTICE 'FIXTURE PASS: web chip within a minute (W) · new app member leaving inside 60 s keeps App (A) · switch web→app (X) · nothing invented (O) · no write when unchanged (T) · refusals (P)';
END
$c$;
