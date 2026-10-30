-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · 20261102_0200 · the gate, as assertions. Run AFTER the migration.
-- Every failure raises 'FIXTURE FAIL <id>: ...'. Run BEFORE the migration it
-- must fail (the runner checks that — fail-first).
-- ═══════════════════════════════════════════════════════════════════════════
DO $a$
DECLARE
  u_off uuid := '00000000-0000-0000-0000-0000000000f0';
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  u5 uuid := '00000000-0000-0000-0000-000000000005';
  adm uuid := '00000000-0000-0000-0000-0000000000ad';
  n integer; t timestamptz; p_before integer; o_before integer; caught text;
  wk date := (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '3 weeks')::date;
  r record;
BEGIN
  -- ── A · switch OFF (no row): nothing is queued, the tick touches nothing ──
  DELETE FROM public.site_settings WHERE key = 'first_post_nudge';
  INSERT INTO auth.users (id, email) VALUES (u_off, 'off@fixture.invalid');
  INSERT INTO public.profiles (id, full_name) VALUES (u_off, 'Off');
  SELECT count(*) INTO n FROM public.first_post_reminders WHERE user_id = u_off;
  IF n <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL A1: switch off but % reminders queued at sign-up', n; END IF;
  IF public.first_post_reminders_tick() <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL A2: tick sent with switch off'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_notifications) OR EXISTS (SELECT 1 FROM fixture.outbox) THEN
    RAISE EXCEPTION 'FIXTURE FAIL A3: something was sent with the switch off';
  END IF;
  -- any value other than "on" is off
  INSERT INTO public.site_settings (key, value) VALUES ('first_post_nudge', to_jsonb('off'::text));
  IF public.first_post_nudge_on() THEN RAISE EXCEPTION 'FIXTURE FAIL A4: "off" read as on'; END IF;
  UPDATE public.site_settings SET value = 'true'::jsonb WHERE key = 'first_post_nudge';
  IF public.first_post_nudge_on() THEN RAISE EXCEPTION 'FIXTURE FAIL A5: true read as on'; END IF;

  -- ── B · switch ON: a new member is queued at +1, +3, +7 days ─────────────
  UPDATE public.site_settings SET value = to_jsonb('on'::text) WHERE key = 'first_post_nudge';
  IF NOT public.first_post_nudge_on() THEN RAISE EXCEPTION 'FIXTURE FAIL B0: "on" not read as on'; END IF;
  t := now() - interval '5 minutes';
  INSERT INTO auth.users (id, email, created_at) VALUES (u1, 'one@fixture.invalid', t);
  INSERT INTO public.profiles (id, full_name) VALUES (u1, 'One <b>');
  SELECT count(*) INTO n FROM public.first_post_reminders
   WHERE user_id = u1 AND status = 'queued'
     AND ((day = 1 AND due_at = t + interval '1 day') OR (day = 3 AND due_at = t + interval '3 days')
       OR (day = 7 AND due_at = t + interval '7 days'));
  IF n <> 3 THEN RAISE EXCEPTION 'FIXTURE FAIL B1: expected 3 reminders at sign-up +1/+3/+7 days, got %', n; END IF;
  IF public.first_post_reminders_tick() <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL B2: sent before due'; END IF;

  -- ── C · day 1 due → one bell row, one push, one e-mail with the post link ─
  UPDATE public.first_post_reminders SET due_at = now() - interval '1 hour' WHERE user_id = u1 AND day = 1;
  n := public.first_post_reminders_tick();
  IF n <> 1 THEN RAISE EXCEPTION 'FIXTURE FAIL C1: tick sent %, expected 1', n; END IF;
  IF (SELECT count(*) FROM public.user_notifications WHERE user_id = u1 AND type = 'first_post_reminder'
        AND email_sent AND dedup_key = 'first_post_reminder:' || u1::text || ':1') <> 1 THEN
    RAISE EXCEPTION 'FIXTURE FAIL C2: bell row missing or wrong';
  END IF;
  IF (SELECT count(*) FROM fixture.pushes WHERE body->>'user_id' = u1::text
        AND body->'data'->>'type' = 'first_post_reminder') <> 1 THEN
    RAISE EXCEPTION 'FIXTURE FAIL C3: the existing push sender was not called once';
  END IF;
  IF (SELECT count(*) FROM fixture.outbox WHERE payload->>'to' = 'one@fixture.invalid'
        AND payload->>'html' LIKE '%href="https://www.50mmretina.com/feed?compose=1"%'
        AND payload->>'text' LIKE '%https://www.50mmretina.com/feed?compose=1%'
        AND payload->>'html' NOT LIKE '%One <b>%'
        AND payload->>'idempotency_key' = 'first-post-' || u1::text || '-1') <> 1 THEN
    RAISE EXCEPTION 'FIXTURE FAIL C4: e-mail missing, wrong link, unescaped name or wrong key';
  END IF;
  IF (SELECT count(*) FROM public.first_post_reminders WHERE user_id = u1 AND status = 'queued') <> 2 THEN
    RAISE EXCEPTION 'FIXTURE FAIL C5: day 3 / day 7 should still be queued';
  END IF;

  -- ── D · idempotent ─────────────────────────────────────────────────────────
  IF public.first_post_reminders_tick() <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL D1: second tick sent again'; END IF;

  -- ── E · the first post (as the member, through RLS) cancels the rest ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.posts (user_id, content) VALUES (u1, 'my first photo');
  RESET ROLE;
  IF (SELECT count(*) FROM public.first_post_reminders WHERE user_id = u1 AND status = 'cancelled' AND cancel_reason = 'posted') <> 2 THEN
    RAISE EXCEPTION 'FIXTURE FAIL E1: the first post did not cancel day 3 and day 7';
  END IF;
  UPDATE public.first_post_reminders SET due_at = now() - interval '1 hour' WHERE user_id = u1;
  IF public.first_post_reminders_tick() <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL E2: sent after the first post'; END IF;

  -- ── F · push and e-mail opt-outs respected (bell row still written) ──────
  INSERT INTO auth.users (id, email) VALUES (u2, 'two@fixture.invalid');
  INSERT INTO public.notification_preferences (user_id, push_enabled, email_reengagement) VALUES (u2, false, false);
  INSERT INTO public.profiles (id, full_name) VALUES (u2, 'Two');
  UPDATE public.first_post_reminders SET due_at = now() - interval '1 hour' WHERE user_id = u2 AND day = 1;
  SELECT count(*) INTO p_before FROM fixture.pushes;
  SELECT count(*) INTO o_before FROM fixture.outbox;
  IF public.first_post_reminders_tick() <> 1 THEN RAISE EXCEPTION 'FIXTURE FAIL F1: u2 day 1 not processed'; END IF;
  IF (SELECT count(*) FROM fixture.pushes) <> p_before THEN RAISE EXCEPTION 'FIXTURE FAIL F2: pushed despite push_enabled = false'; END IF;
  IF (SELECT count(*) FROM fixture.outbox) <> o_before THEN RAISE EXCEPTION 'FIXTURE FAIL F3: e-mailed despite email_reengagement = false'; END IF;

  -- ── G · suppressed address: no e-mail, push still goes ───────────────────
  INSERT INTO auth.users (id, email) VALUES (u3, 'Three@fixture.invalid');
  INSERT INTO public.suppressed_emails (email) VALUES ('three@fixture.invalid');
  INSERT INTO public.profiles (id, full_name) VALUES (u3, 'Three');
  UPDATE public.first_post_reminders SET due_at = now() - interval '1 hour' WHERE user_id = u3 AND day = 1;
  SELECT count(*) INTO p_before FROM fixture.pushes;
  SELECT count(*) INTO o_before FROM fixture.outbox;
  PERFORM public.first_post_reminders_tick();
  IF (SELECT count(*) FROM fixture.outbox) <> o_before THEN RAISE EXCEPTION 'FIXTURE FAIL G1: e-mailed a suppressed address'; END IF;
  IF (SELECT count(*) FROM fixture.pushes) <> p_before + 1 THEN RAISE EXCEPTION 'FIXTURE FAIL G2: push not sent'; END IF;

  -- ── H · more than a day late: cancelled, never a late burst ──────────────
  INSERT INTO auth.users (id, email) VALUES (u4, 'four@fixture.invalid');
  INSERT INTO public.profiles (id, full_name) VALUES (u4, 'Four');
  UPDATE public.first_post_reminders SET due_at = now() - interval '2 days' WHERE user_id = u4 AND day = 1;
  IF public.first_post_reminders_tick() <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL H1: a late reminder was sent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.first_post_reminders WHERE user_id = u4 AND day = 1 AND status = 'cancelled' AND cancel_reason = 'late') THEN
    RAISE EXCEPTION 'FIXTURE FAIL H2: late row not cancelled';
  END IF;

  -- ── I · switch back OFF: due rows are left alone, nothing is sent ────────
  INSERT INTO auth.users (id, email) VALUES (u5, 'five@fixture.invalid');
  INSERT INTO public.profiles (id, full_name) VALUES (u5, 'Five');
  UPDATE public.first_post_reminders SET due_at = now() - interval '1 hour' WHERE user_id = u5 AND day = 1;
  DELETE FROM public.site_settings WHERE key = 'first_post_nudge';
  SELECT count(*) INTO n FROM public.user_notifications;
  IF public.first_post_reminders_tick() <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL I1: sent with the switch off'; END IF;
  IF (SELECT count(*) FROM public.user_notifications) <> n THEN RAISE EXCEPTION 'FIXTURE FAIL I2: bell row with the switch off'; END IF;
  IF (SELECT status FROM public.first_post_reminders WHERE user_id = u5 AND day = 1) <> 'queued' THEN
    RAISE EXCEPTION 'FIXTURE FAIL I3: switch off changed a queued row';
  END IF;

  -- ── J · Admin → Health: correct against a known week; admins only ────────
  -- Week `wk` (3 weeks ago, Monday, UTC): 4 members — posted on day 2, posted
  -- on day 6, posted on day 9 (too late), never posted → 2 of 4 = 50.0 %.
  INSERT INTO auth.users (id, email, created_at) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'a1@fixture.invalid', (wk::timestamp AT TIME ZONE 'UTC') + interval '1 day'),
    ('00000000-0000-0000-0000-0000000000a2', 'a2@fixture.invalid', (wk::timestamp AT TIME ZONE 'UTC') + interval '2 days'),
    ('00000000-0000-0000-0000-0000000000a3', 'a3@fixture.invalid', (wk::timestamp AT TIME ZONE 'UTC') + interval '3 days'),
    ('00000000-0000-0000-0000-0000000000a4', 'a4@fixture.invalid', (wk::timestamp AT TIME ZONE 'UTC') + interval '6 days 23 hours'),
    (adm, 'admin@fixture.invalid', now() - interval '400 days');
  INSERT INTO public.profiles (id) SELECT id FROM auth.users WHERE email LIKE 'a_@fixture.invalid' OR id = adm;
  INSERT INTO public.posts (user_id, created_at) VALUES
    ('00000000-0000-0000-0000-0000000000a1', (wk::timestamp AT TIME ZONE 'UTC') + interval '3 days'),
    ('00000000-0000-0000-0000-0000000000a2', (wk::timestamp AT TIME ZONE 'UTC') + interval '8 days'),
    ('00000000-0000-0000-0000-0000000000a3', (wk::timestamp AT TIME ZONE 'UTC') + interval '12 days');
  INSERT INTO public.user_roles (user_id, role) VALUES (adm, 'admin');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.admin_first_post_rate(8);
    caught := 'no error';
  EXCEPTION WHEN insufficient_privilege THEN caught := 'refused';
  END;
  RESET ROLE;
  IF caught <> 'refused' THEN RAISE EXCEPTION 'FIXTURE FAIL J1: a non-admin read the Health number (%)', caught; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM public.admin_first_post_rate(8) x WHERE x.week_start = wk;
  RESET ROLE;
  IF r.members IS DISTINCT FROM 4 OR r.posted_within_7d IS DISTINCT FROM 2 OR r.pct IS DISTINCT FROM 50.0 OR r.complete IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FIXTURE FAIL J2: week % → members=% posted=% pct=% complete=% (expected 4, 2, 50.0, true)',
      wk, r.members, r.posted_within_7d, r.pct, r.complete;
  END IF;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.admin_first_post_rate(8);
  RESET ROLE;
  IF n <> 8 THEN RAISE EXCEPTION 'FIXTURE FAIL J3: expected 8 weeks, got %', n; END IF;

  -- ── K · a member can neither read the queue nor run the tick ─────────────
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM public.first_post_reminders LIMIT 1;
    caught := 'read';
  EXCEPTION WHEN insufficient_privilege THEN caught := 'refused';
  END;
  IF caught <> 'refused' THEN RESET ROLE; RAISE EXCEPTION 'FIXTURE FAIL K1: a member read the queue'; END IF;
  BEGIN
    PERFORM public.first_post_reminders_tick();
    caught := 'ran';
  EXCEPTION WHEN insufficient_privilege THEN caught := 'refused';
  END;
  RESET ROLE;
  IF caught <> 'refused' THEN RAISE EXCEPTION 'FIXTURE FAIL K2: a member ran the tick'; END IF;

  RAISE NOTICE 'FIXTURE PASS: A (switch off) B (queued 1/3/7) C (bell+push+email link) D (idempotent) E (first post cancels) F (opt-outs) G (suppressed) H (late) I (off again) J (Health 50.0%% + admin only) K (server-only)';
END
$a$;
