-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0800 a member cannot write a result. WRITES NOTHING: the
-- whole file is one transaction that ends in ROLLBACK.
--
-- Acts as a REAL ordinary member (SET ROLE authenticated + that member's JWT
-- claims — the same path the app takes), on a real entry whose competition is
-- set, inside this transaction only, to "taking entries":
--   attacks (must be REFUSED after 0800, and succeed before — the proof):
--     A1 pin own entry · A2 +1000 views · A3 placement winner · A4 status step
--     A5 own "winner" certificate for an entry that is not eligible
--     A6 "finalist" certificate when the page would offer "winner"
--     A7 a vote after voting closed
--   normal use (must WORK before and after — nothing broken):
--     N1 owner edits the title · N2 the certificate the page offers
--        (title is the page's wording, not the member's) · N3 a vote while open
-- FAILS before apply. PASS = every attack refused, every normal use works,
-- the three triggers in place. Prints counts of old rows only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = notice;

-- run one statement as a member; never keeps its effect (the block always rolls back)
CREATE FUNCTION pg_temp.as_member(_uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE _v text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    SET LOCAL ROLE authenticated;
    EXECUTE _sql INTO _v;
    RAISE EXCEPTION 'PROBE_OK:%', coalesce(_v, '<no row>');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_OK:%' THEN RETURN 'ok ' || substr(SQLERRM, 10); END IF;
    RETURN 'refused ' || SQLSTATE || ' ' || left(SQLERRM, 150);
  END;
END
$f$;

DO $p$
DECLARE
  _e uuid; _owner uuid; _comp uuid; _st text; _voter uuid; _ctitle text;
  r text; _bad text[] := '{}'; _fixture text[] := '{}';
  _ok boolean; _n1 text := 'works';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- a plain member (not admin, not banned, a real account) with an entry that has a photo
  SELECT e.id, e.user_id, e.competition_id, e.status INTO _e, _owner, _comp, _st
    FROM public.competition_entries e
    JOIN auth.users u ON u.id = e.user_id
    JOIN public.profiles p ON p.id = e.user_id
   WHERE cardinality(e.photos) >= 1 AND NOT coalesce(p.is_banned, false)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = e.user_id AND ur.role::text = 'admin')
     AND e.status IN ('submitted', 'approved', 'round1_qualified', 'shortlisted', 'needs_review', 'hold', 'rejected')
   ORDER BY (e.status = 'submitted') DESC, e.created_at DESC
   LIMIT 1;
  -- no member entry on this lane (production 13 Nov: none — PROBE 0801 run
  -- 43456367522): make a test competition and entry, in this transaction only.
  IF _e IS NULL THEN
    SELECT u.id INTO _owner FROM auth.users u JOIN public.profiles p ON p.id = u.id
     WHERE NOT coalesce(p.is_banned, false)
       AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role::text = 'admin')
     ORDER BY u.created_at LIMIT 1;
    IF _owner IS NULL THEN
      RAISE EXCEPTION 'PROBE FAIL: no plain member on this lane — cannot test';
    END IF;
    -- status "upcoming": notify_new_competition only announces status "open"
    INSERT INTO public.competitions (title, starts_at, ends_at, created_by, status, phase)
    VALUES ('PROBE 0800 test competition (rolled back)', now() - interval '1 day', now() + interval '1 day', _owner, 'upcoming', 'submission_open')
    RETURNING id INTO _comp;
    INSERT INTO public.competition_entries (competition_id, user_id, title, status, is_ai_advisory)
    VALUES (_comp, _owner, 'PROBE 0800 test entry', 'submitted', false)
    RETURNING id, status INTO _e, _st;
    RAISE NOTICE 'FIXTURE no member entry on this lane — a test competition and entry were made inside this transaction (rolled back)';
  END IF;
  SELECT u.id INTO _voter FROM auth.users u JOIN public.profiles p ON p.id = u.id
   WHERE u.id IS DISTINCT FROM _owner AND NOT coalesce(p.is_banned, false)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role::text = 'admin')
   ORDER BY u.created_at DESC LIMIT 1;
  IF _voter IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: no second plain member on this lane — cannot test';
  END IF;

  -- fixture, this transaction only: the competition takes entries and votes
  UPDATE public.competitions
     SET phase = 'submission_open', starts_at = now() - interval '1 day', ends_at = now() + interval '1 day',
         voting_ends_at = now() + interval '2 days',
         status = CASE WHEN status IN ('archived', 'cancelled') THEN 'open' ELSE status END
   WHERE id = _comp
  RETURNING title INTO _ctitle;
  -- the owner sees and edits a "submitted" entry (a rejected one is hidden from them)
  IF _st IS DISTINCT FROM 'submitted' THEN
    UPDATE public.competition_entries SET status = 'submitted', current_round = '1', placement = NULL WHERE id = _e;
    _st := 'submitted';
  END IF;

  -- ── entries ──
  r := pg_temp.as_member(_owner, format('UPDATE public.competition_entries SET title = left(coalesce(title, %L), 180) || %L WHERE id = %L RETURNING id::text', '', ' ·probe', _e));
  RAISE NOTICE 'N1 owner edits title ............ %', r;
  -- 42P17 = the pre-0802 policy (its WITH CHECK reads competition_entries from
  -- inside its own policy, which Postgres refuses for every member UPDATE). That
  -- is an old break 0802 repairs, not something 0800 caused; reported, not failed.
  IF r LIKE 'refused 42P17%' THEN _n1 := 'still blocked by the old recursive policy (0802 not applied)';
  ELSIF r NOT LIKE 'ok %' OR r = 'ok <no row>' THEN _fixture := _fixture || ('N1 ' || r); END IF;

  r := pg_temp.as_member(_owner, format('UPDATE public.competition_entries SET is_pinned = NOT coalesce(is_pinned, false) WHERE id = %L RETURNING id::text', _e));
  RAISE NOTICE 'A1 pin own entry ................ %', r;
  IF r LIKE 'ok %' AND r <> 'ok <no row>' THEN _bad := _bad || 'A1 pin'::text; END IF;

  r := pg_temp.as_member(_owner, format('UPDATE public.competition_entries SET view_count = coalesce(view_count, 0) + 1000 WHERE id = %L RETURNING id::text', _e));
  RAISE NOTICE 'A2 +1000 views .................. %', r;
  IF r LIKE 'ok %' AND r <> 'ok <no row>' THEN _bad := _bad || 'A2 views'::text; END IF;

  r := pg_temp.as_member(_owner, format('UPDATE public.competition_entries SET placement = %L WHERE id = %L RETURNING id::text', 'winner', _e));
  RAISE NOTICE 'A3 placement = winner ........... %', r;
  IF r LIKE 'ok %' AND r <> 'ok <no row>' THEN _bad := _bad || 'A3 placement'::text; END IF;

  IF _st = 'submitted' THEN
    r := pg_temp.as_member(_owner, format('UPDATE public.competition_entries SET status = %L WHERE id = %L RETURNING id::text', 'round1_qualified', _e));
    RAISE NOTICE 'A4 status submitted -> qualified  %', r;
    IF r LIKE 'ok %' AND r <> 'ok <no row>' THEN _bad := _bad || 'A4 status'::text; END IF;
  ELSE
    RAISE NOTICE 'A4 status step .................. n/a (test entry is %, not submitted)', _st;
  END IF;

  -- a direct INSERT (the app submits through a server function; the policy still allows this path)
  r := pg_temp.as_member(_voter, format(
    'INSERT INTO public.competition_entries (competition_id, user_id, title, is_ai_advisory, placement) VALUES (%L, %L, %L, false, %L) RETURNING id::text',
    _comp, _voter, 'PROBE direct entry', 'winner'));
  RAISE NOTICE 'A8 new entry born a winner ...... %', r;
  IF r LIKE 'ok %' THEN _bad := _bad || 'A8 insert with result'::text; END IF;
  r := pg_temp.as_member(_voter, format(
    'INSERT INTO public.competition_entries (competition_id, user_id, title, is_ai_advisory) VALUES (%L, %L, %L, false) RETURNING id::text',
    _comp, _voter, 'PROBE direct entry'));
  RAISE NOTICE 'N4 plain new entry, direct ...... %', r;
  -- only the guard refusing a PLAIN entry is a break (0803 corrects that); a
  -- competition's own limits (fee, entry limit) may refuse it for other reasons.
  IF r LIKE '%A new entry starts as submitted%' THEN _fixture := _fixture || ('N4 ' || r); END IF;

  -- ── certificates ──
  UPDATE public.competition_entries SET certificate_ready = false WHERE id = _e;
  r := pg_temp.as_member(_owner, format(
    'INSERT INTO public.certificates (user_id, title, type, reference_id, description) VALUES (%L, %L, %L, %L, %L) RETURNING title',
    _owner, 'Winner — fake', 'winner', _e, 'fake'));
  RAISE NOTICE 'A5 own Winner cert, not eligible  %', r;
  IF r LIKE 'ok %' THEN _bad := _bad || 'A5 winner cert'::text; END IF;

  -- make it truly eligible for "winner" (R4 declared, placement winner, ready)
  UPDATE public.competition_entries SET certificate_ready = true, placement = 'winner' WHERE id = _e;
  INSERT INTO public.competition_round_publish (competition_id, round_number, published_at)
  VALUES (_comp, 4, now())
  ON CONFLICT (competition_id, round_number) DO UPDATE SET published_at = now();
  DELETE FROM public.certificates WHERE user_id = _owner AND type IN ('winner', 'finalist') AND reference_id IN (_e, _comp);

  r := pg_temp.as_member(_owner, format(
    'INSERT INTO public.certificates (user_id, title, type, reference_id, description) VALUES (%L, %L, %L, %L, %L) RETURNING title',
    _owner, 'FINALIST — fake', 'finalist', _e, 'fake'));
  RAISE NOTICE 'A6 Finalist cert, page offers Winner %', r;
  IF r LIKE 'ok %' THEN _bad := _bad || 'A6 wrong cert type'::text; END IF;

  r := pg_temp.as_member(_owner, format(
    'INSERT INTO public.certificates (user_id, title, type, reference_id, description) VALUES (%L, %L, %L, %L, %L) RETURNING title',
    _owner, 'MEMBER TYPED THIS', 'winner', _e, 'MEMBER TYPED THIS'));
  RAISE NOTICE 'N2 the cert the page offers ..... %', r;
  IF r NOT LIKE 'ok %' THEN
    _fixture := _fixture || ('N2 ' || r);
  ELSIF r <> 'ok Winner — ' || coalesce(nullif(_ctitle, ''), 'Competition') THEN
    _bad := _bad || 'N2 title not the page wording'::text;
  END IF;

  -- ── votes ──
  r := pg_temp.as_member(_voter, format('INSERT INTO public.competition_votes (entry_id, user_id, photo_index) VALUES (%L, %L, 0) RETURNING id::text', _e, _voter));
  RAISE NOTICE 'N3 vote while open .............. %', r;
  IF r NOT LIKE 'ok %' OR r = 'ok <no row>' THEN _fixture := _fixture || ('N3 ' || r); END IF;

  UPDATE public.competitions
     SET phase = 'judging', ends_at = now() - interval '2 days', voting_ends_at = now() - interval '1 day'
   WHERE id = _comp;
  r := pg_temp.as_member(_voter, format('INSERT INTO public.competition_votes (entry_id, user_id, photo_index) VALUES (%L, %L, 0) RETURNING id::text', _e, _voter));
  RAISE NOTICE 'A7 vote after voting closed ..... %', r;
  IF r LIKE 'ok %' THEN _bad := _bad || 'A7 late vote'::text; END IF;

  -- ── old rows (counts only, nothing changed) ──
  RAISE NOTICE 'OLD member-type award certificates whose entry does not match: winner % ; finalist %',
    (SELECT count(*) FROM public.certificates k JOIN public.competition_entries e ON e.id = k.reference_id
      WHERE k.type = 'winner' AND e.placement IS DISTINCT FROM 'winner'),
    (SELECT count(*) FROM public.certificates k JOIN public.competition_entries e ON e.id = k.reference_id
      WHERE k.type = 'finalist' AND e.status NOT IN ('finalist', 'shortlisted')
        AND coalesce(e.placement, '') NOT IN ('1st_runner_up', '2nd_runner_up', 'runner_up_1', 'runner_up_2', 'winner'));
  RAISE NOTICE 'OLD votes cast after voting closed: %',
    (SELECT count(*) FROM public.competition_votes v JOIN public.competition_entries e ON e.id = v.entry_id
       JOIN public.competitions c ON c.id = e.competition_id
      WHERE c.voting_ends_at IS NOT NULL AND v.created_at > c.voting_ends_at);

  -- ── structure ──
  _ok := (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
           AND tgname IN ('trg_0_entry_member_write_guard', 'trg_0_certificate_member_request_guard', 'trg_0_vote_window_guard')) = 3;

  IF array_length(_fixture, 1) > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: normal use did not work (a break, or the test could not run): %', array_to_string(_fixture, ' | ');
  END IF;
  IF array_length(_bad, 1) > 0 OR NOT _ok THEN
    RAISE EXCEPTION 'PROBE FAIL: holes open: % ; guards installed: %', array_to_string(_bad, ', '), _ok;
  END IF;
  RAISE NOTICE 'MW0800 PASS (lane %): every attack refused; offered certificate + open vote work; owner edit of an entry: %',
    current_setting('p32.lane'), _n1;
END
$p$;

ROLLBACK;
