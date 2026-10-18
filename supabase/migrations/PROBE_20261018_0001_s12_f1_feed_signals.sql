-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261018_0001 — S12-F1 Signals + Hide + Mute (staging and production)
-- Writes test rows INSIDE its own transaction and ends in ROLLBACK: nothing it
-- does survives. Raises, and so fails the dispatch, on any hit. Run after
-- 20261018_0001; FAILS before it (G1: the tables do not exist).
--
--   G0 · lane guard: p32.lane must be staging or production.
--   G1 · static: the five tables exist with RLS on; the policy set is exact
--        (one permissive policy per action + the deleted-account restriction);
--        anon has no privilege; authenticated has exactly what was granted;
--        the four functions are not executable by PUBLIC, anon or
--        authenticated; the three triggers enabled; PRIMARY KEY (id) on the
--        ledger and the natural primary keys on hide / mute (the OFF-2
--        exactly-once keys and the feed RPC's exclusion indexes); the purge
--        job is scheduled.
--   G2 · behaviour, as real members with their JWT claims (SET LOCAL ROLE
--        authenticated), all rolled back:
--        A (a member) on P (a public post by C ≠ A):
--          a. dwell 1,500 / skip / watch 40 / share click / visit C's profile →
--             five ledger rows; subject_id is overwritten with P's real author;
--          b. visiting A's OWN profile is skipped (own-member data only);
--          c. EXACTLY ONCE: the same ids resent → still five rows, and the
--             aggregates still read dwell 1,500, watch 40, 1 skip, 1 share
--             click, 1 visit;
--          d. a post A may not see (private, not A's) is skipped — signal and
--             hide — if one exists;
--          e. dwell 600,001 ms → refused by the CHECK;
--          f. a row in B's name → refused by RLS (ledger, hide, mute);
--          g. UPDATE of an aggregate → refused (no grant);
--          h. HIDE P twice → one row; MUTE C twice → one row (exactly once);
--             muting oneself → refused by the CHECK.
--        B (another member) — the CROSS-MEMBER test:
--          i. reads 0 of A's rows in each of the five tables;
--          j. a bare DELETE on hide / mute removes nothing of A's; a DELETE on
--             the ledger is refused (no grant).
--        A again: k. unmute removes A's mute.
--        anon: l. cannot read or insert (signals, hide, mute).
--        a deleted account (valid JWT, no auth.users row): m. insert refused.
--   G3 · the purge runs (as the probe's own role, inside the rollback).
--   G4 · NOTICE only: ledger inflow (last hour / 24 h), table sizes — the
--        partitioning trigger point named in the migration header.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $probe$
DECLARE
  r       record;
  _bad    text := '';
  a       uuid;
  b       uuid;
  c       uuid;
  p       uuid;
  q       uuid;
  ghost   uuid := gen_random_uuid();
  x1      uuid := gen_random_uuid();
  x2      uuid := gen_random_uuid();
  x3      uuid := gen_random_uuid();
  x4      uuid := gen_random_uuid();
  x5      uuid := gen_random_uuid();
  x6      uuid := gen_random_uuid();
  x7      uuid := gen_random_uuid();
  n       bigint;
  n2      bigint;
  n3      bigint;
  n4      bigint;
  n5      bigint;
  failed  boolean;
  ps      record;
  _h      bigint;
  _d      bigint;
BEGIN
  -- G0 · lane guard.
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED 20261018_0001 — p32.lane reads %; dispatch apply-migration.yml with target=staging or production.',
      coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · static.
  IF to_regclass('public.feed_signal_events') IS NULL OR to_regclass('public.feed_post_signals') IS NULL
     OR to_regclass('public.feed_author_signals') IS NULL OR to_regclass('public.feed_hidden_posts') IS NULL
     OR to_regclass('public.feed_muted_authors') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0001 G1: the signals / hide / mute tables do not exist — the migration is not applied';
  END IF;
  FOR r IN SELECT unnest(ARRAY['feed_signal_events', 'feed_post_signals', 'feed_author_signals',
                               'feed_hidden_posts', 'feed_muted_authors']) AS t LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || r.t)::regclass) THEN
      _bad := _bad || E'\n  G1 ' || r.t || ': RLS not enabled';
    END IF;
  END LOOP;
  IF (SELECT string_agg(tablename || '|' || policyname || '|' || cmd || '|' || permissive || '|' || array_to_string(roles, ','), ';' ORDER BY tablename, policyname)
        FROM pg_policies WHERE schemaname = 'public'
         AND tablename IN ('feed_signal_events', 'feed_post_signals', 'feed_author_signals', 'feed_hidden_posts', 'feed_muted_authors'))
     IS DISTINCT FROM
       'feed_author_signals|Members read own author signals|SELECT|PERMISSIVE|authenticated;'
    || 'feed_hidden_posts|Deleted accounts cannot insert|INSERT|RESTRICTIVE|authenticated;'
    || 'feed_hidden_posts|Members hide posts for themselves|INSERT|PERMISSIVE|authenticated;'
    || 'feed_hidden_posts|Members read own hidden posts|SELECT|PERMISSIVE|authenticated;'
    || 'feed_hidden_posts|Members unhide own hidden posts|DELETE|PERMISSIVE|authenticated;'
    || 'feed_muted_authors|Deleted accounts cannot insert|INSERT|RESTRICTIVE|authenticated;'
    || 'feed_muted_authors|Members mute for themselves|INSERT|PERMISSIVE|authenticated;'
    || 'feed_muted_authors|Members read own mutes|SELECT|PERMISSIVE|authenticated;'
    || 'feed_muted_authors|Members unmute own mutes|DELETE|PERMISSIVE|authenticated;'
    || 'feed_post_signals|Members read own post signals|SELECT|PERMISSIVE|authenticated;'
    || 'feed_signal_events|Deleted accounts cannot insert|INSERT|RESTRICTIVE|authenticated;'
    || 'feed_signal_events|Members insert own signals|INSERT|PERMISSIVE|authenticated;'
    || 'feed_signal_events|Members read own signals|SELECT|PERMISSIVE|authenticated' THEN
    _bad := _bad || E'\n  G1 the policy set on the S12-F1 tables is not the intended one';
  END IF;
  FOR r IN
    SELECT t, pr, want FROM (VALUES
      ('feed_signal_events', 'SELECT', true), ('feed_signal_events', 'INSERT', true),
      ('feed_signal_events', 'UPDATE', false), ('feed_signal_events', 'DELETE', false), ('feed_signal_events', 'TRUNCATE', false),
      ('feed_post_signals', 'SELECT', true), ('feed_post_signals', 'INSERT', false),
      ('feed_post_signals', 'UPDATE', false), ('feed_post_signals', 'DELETE', false),
      ('feed_author_signals', 'SELECT', true), ('feed_author_signals', 'INSERT', false),
      ('feed_author_signals', 'UPDATE', false), ('feed_author_signals', 'DELETE', false),
      ('feed_hidden_posts', 'SELECT', true), ('feed_hidden_posts', 'INSERT', true),
      ('feed_hidden_posts', 'UPDATE', false), ('feed_hidden_posts', 'DELETE', true), ('feed_hidden_posts', 'TRUNCATE', false),
      ('feed_muted_authors', 'SELECT', true), ('feed_muted_authors', 'INSERT', true),
      ('feed_muted_authors', 'UPDATE', false), ('feed_muted_authors', 'DELETE', true), ('feed_muted_authors', 'TRUNCATE', false)
    ) v(t, pr, want)
  LOOP
    IF has_table_privilege('authenticated', 'public.' || r.t, r.pr) IS DISTINCT FROM r.want THEN
      _bad := _bad || E'\n  G1 authenticated ' || r.pr || ' on ' || r.t || ' = ' || (NOT r.want)::text;
    END IF;
    IF has_table_privilege('anon', 'public.' || r.t, r.pr) THEN
      _bad := _bad || E'\n  G1 anon has ' || r.pr || ' on ' || r.t;
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['public.feed_signal_events_before()', 'public.feed_signal_events_fold()',
                               'public.feed_hidden_posts_before()', 'public.purge_feed_signals(integer)']) AS f LOOP
    IF to_regprocedure(r.f) IS NULL THEN
      _bad := _bad || E'\n  G1 ' || r.f || ' missing';
    ELSIF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc pp, aclexplode(coalesce(pp.proacl, acldefault('f', pp.proowner))) x
                   WHERE pp.oid = r.f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  G1 ' || r.f || ' is executable by PUBLIC, anon or authenticated';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.feed_signal_events'::regclass AND NOT tgisinternal
        AND tgenabled = 'O' AND tgname IN ('feed_signal_events_before', 'feed_signal_events_fold')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.feed_hidden_posts'::regclass AND NOT tgisinternal
        AND tgenabled = 'O' AND tgname = 'feed_hidden_posts_before') THEN
    _bad := _bad || E'\n  G1 the S12-F1 triggers are not all present and enabled';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('feed_signal_events', ARRAY['id']::name[]), ('feed_hidden_posts', ARRAY['user_id', 'post_id']::name[]),
      ('feed_muted_authors', ARRAY['user_id', 'author_id']::name[])) v(t, cols) LOOP
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint k WHERE k.conrelid = ('public.' || r.t)::regclass AND k.contype = 'p'
           AND (SELECT array_agg(at.attname ORDER BY o.ord) FROM unnest(k.conkey) WITH ORDINALITY o(attnum, ord)
                  JOIN pg_attribute at ON at.attrelid = k.conrelid AND at.attnum = o.attnum) = r.cols) THEN
      _bad := _bad || E'\n  G1 ' || r.t || ' has no PRIMARY KEY (' || array_to_string(r.cols, ', ') || ') — the exactly-once key';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-feed-signals') THEN
    _bad := _bad || E'\n  G1 cron job purge-feed-signals missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0001:%', _bad;
  END IF;

  -- G2 · pick the cast: a public post P by C; members A and B (≠ C, ≠ each other).
  SELECT po.id, po.user_id INTO p, c
    FROM public.posts po
   WHERE po.privacy = 'public' AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = po.user_id)
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = po.user_id)
   ORDER BY po.created_at DESC LIMIT 1;
  IF p IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G2: no public post by a member with a profile on this lane'; END IF;
  WITH m AS (SELECT u.id FROM auth.users u WHERE u.id <> c ORDER BY u.id LIMIT 2)
  SELECT min(id::text)::uuid, max(id::text)::uuid INTO a, b FROM m HAVING count(*) = 2;
  IF a IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G2: fewer than two accounts besides the post author'; END IF;
  SELECT po.id INTO q FROM public.posts po
   WHERE po.privacy = 'private' AND po.user_id <> a ORDER BY po.created_at DESC LIMIT 1;

  -- as A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  -- a, b: five recorded (subject_id deliberately wrong — the server sets it), A's own profile skipped
  INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES
    (x1, a, 'dwell', p, a, 1500), (x2, a, 'skip', p, a, 0), (x3, a, 'watch', p, a, 40),
    (x4, a, 'share_click', p, a, 0), (x5, a, 'profile_visit', NULL, c, 0), (x6, a, 'profile_visit', NULL, a, 0)
  ON CONFLICT (id) DO NOTHING;
  SELECT count(*) INTO n FROM public.feed_signal_events WHERE id IN (x1, x2, x3, x4, x5, x6);
  IF n <> 5 THEN _bad := _bad || E'\n  G2a/b A recorded ' || n || ' of 6 rows (want 5: own profile skipped)'; END IF;
  IF EXISTS (SELECT 1 FROM public.feed_signal_events WHERE id IN (x1, x2, x3, x4) AND subject_id <> c) THEN
    _bad := _bad || E'\n  G2a subject_id was not overwritten with the post''s author';
  END IF;
  -- c: the same ids again — a resend after a lost answer
  INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES
    (x1, a, 'dwell', p, c, 1500), (x2, a, 'skip', p, c, 0), (x3, a, 'watch', p, c, 40),
    (x4, a, 'share_click', p, c, 0), (x5, a, 'profile_visit', NULL, c, 0)
  ON CONFLICT (id) DO NOTHING;
  SELECT count(*) INTO n FROM public.feed_signal_events WHERE id IN (x1, x2, x3, x4, x5, x6);
  IF n <> 5 THEN _bad := _bad || E'\n  G2c a resend added rows: ' || n || ' (want 5)'; END IF;
  SELECT dwell_ms, watch_pct, skips, share_clicks, author_id INTO ps FROM public.feed_post_signals WHERE user_id = a AND post_id = p;
  IF ps IS NULL OR ps.dwell_ms <> 1500 OR ps.watch_pct <> 40 OR ps.skips <> 1 OR ps.share_clicks <> 1 OR ps.author_id <> c THEN
    _bad := _bad || E'\n  G2c feed_post_signals after a resend: ' || coalesce(row_to_json(ps)::text, 'no row')
            || ' (want dwell 1500, watch 40, 1 skip, 1 share click, author C) — not exactly once';
  END IF;
  SELECT profile_visits INTO n FROM public.feed_author_signals WHERE user_id = a AND author_id = c;
  IF n IS DISTINCT FROM 1 THEN _bad := _bad || E'\n  G2c profile visits after a resend: ' || coalesce(n::text, 'no row') || ' (want 1)'; END IF;
  IF EXISTS (SELECT 1 FROM public.feed_author_signals WHERE user_id = a AND author_id = a) THEN
    _bad := _bad || E'\n  G2b A''s visit to their own profile was recorded';
  END IF;
  -- d: a post A may not see
  IF q IS NOT NULL THEN
    INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES (x7, a, 'dwell', q, a, 1000);
    IF EXISTS (SELECT 1 FROM public.feed_signal_events WHERE id = x7) THEN
      _bad := _bad || E'\n  G2d a signal about a private post A may not see was recorded';
    END IF;
    INSERT INTO public.feed_hidden_posts (user_id, post_id) VALUES (a, q) ON CONFLICT (user_id, post_id) DO NOTHING;
    IF EXISTS (SELECT 1 FROM public.feed_hidden_posts WHERE user_id = a AND post_id = q) THEN
      _bad := _bad || E'\n  G2d A hid a private post A may not see';
    END IF;
  END IF;
  -- e: the CHECK bound
  failed := false;
  BEGIN
    INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES (gen_random_uuid(), a, 'dwell', p, c, 600001);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2e a dwell of 600,001 ms was accepted'; END IF;
  -- f: rows in B's name
  failed := false;
  BEGIN
    INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES (gen_random_uuid(), b, 'dwell', p, c, 1000);
  EXCEPTION WHEN insufficient_privilege THEN failed := (SQLERRM LIKE '%row-level security%');
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2f A could insert a signal with user_id = B'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.feed_hidden_posts (user_id, post_id) VALUES (b, p);
  EXCEPTION WHEN insufficient_privilege THEN failed := (SQLERRM LIKE '%row-level security%');
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2f A could hide a post in B''s name'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (b, c);
  EXCEPTION WHEN insufficient_privilege THEN failed := (SQLERRM LIKE '%row-level security%');
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2f A could mute in B''s name'; END IF;
  -- g: aggregates are not writable by members
  failed := false;
  BEGIN
    UPDATE public.feed_post_signals SET dwell_ms = 0 WHERE user_id = a;
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2g authenticated can UPDATE feed_post_signals'; END IF;
  -- h: hide and mute, each sent twice (a resend) → one row each
  INSERT INTO public.feed_hidden_posts (user_id, post_id, reason) VALUES (a, p, 'not_interested') ON CONFLICT (user_id, post_id) DO NOTHING;
  INSERT INTO public.feed_hidden_posts (user_id, post_id, reason) VALUES (a, p, 'not_interested') ON CONFLICT (user_id, post_id) DO NOTHING;
  INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (a, c) ON CONFLICT (user_id, author_id) DO NOTHING;
  INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (a, c) ON CONFLICT (user_id, author_id) DO NOTHING;
  SELECT count(*) INTO n FROM public.feed_hidden_posts WHERE user_id = a AND post_id = p;
  SELECT count(*) INTO n2 FROM public.feed_muted_authors WHERE user_id = a AND author_id = c;
  IF n <> 1 OR n2 <> 1 THEN _bad := _bad || E'\n  G2h hide sent twice → ' || n || ' row(s), mute sent twice → ' || n2 || ' row(s) (want 1, 1)'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (a, a);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2h A could mute themselves'; END IF;
  RESET ROLE;

  -- as B — the cross-member test
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n  FROM public.feed_signal_events  WHERE user_id <> b;
  SELECT count(*) INTO n2 FROM public.feed_post_signals   WHERE user_id <> b;
  SELECT count(*) INTO n3 FROM public.feed_author_signals WHERE user_id <> b;
  SELECT count(*) INTO n4 FROM public.feed_hidden_posts   WHERE user_id <> b;
  SELECT count(*) INTO n5 FROM public.feed_muted_authors  WHERE user_id <> b;
  IF n + n2 + n3 + n4 + n5 <> 0 THEN
    _bad := _bad || E'\n  G2i B reads other members'' rows: ledger ' || n || ', post ' || n2 || ', author ' || n3
            || ', hidden ' || n4 || ', muted ' || n5 || ' (want all 0)';
  END IF;
  -- bare DELETEs: only the DELETE policy decides (no WHERE for SELECT to hide behind)
  DELETE FROM public.feed_hidden_posts;
  DELETE FROM public.feed_muted_authors;
  failed := false;
  BEGIN
    DELETE FROM public.feed_signal_events;
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2j authenticated can DELETE from feed_signal_events'; END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.feed_hidden_posts WHERE user_id = a AND post_id = p;
  SELECT count(*) INTO n2 FROM public.feed_muted_authors WHERE user_id = a AND author_id = c;
  IF n <> 1 OR n2 <> 1 THEN _bad := _bad || E'\n  G2j a bare DELETE by B removed A''s hide (' || (1 - n) || ') / mute (' || (1 - n2) || ')'; END IF;

  -- k: A unmutes
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.feed_muted_authors WHERE user_id = a AND author_id = c;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.feed_muted_authors WHERE user_id = a AND author_id = c) THEN
    _bad := _bad || E'\n  G2k A could not unmute';
  END IF;

  -- l: anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  FOR r IN SELECT unnest(ARRAY['feed_post_signals', 'feed_hidden_posts', 'feed_muted_authors']) AS t LOOP
    failed := false;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', r.t);
    EXCEPTION WHEN insufficient_privilege THEN failed := true;
    END;
    IF NOT failed THEN _bad := _bad || E'\n  G2l anon can read ' || r.t; END IF;
  END LOOP;
  failed := false;
  BEGIN
    INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES (gen_random_uuid(), a, 'skip', p, c, 0);
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2l anon can insert into feed_signal_events'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (a, c);
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2l anon can insert into feed_muted_authors'; END IF;
  RESET ROLE;

  -- m: a deleted account (valid JWT, no auth.users row)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ghost, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ghost::text, true);
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN
    INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES (gen_random_uuid(), ghost, 'skip', p, c, 0);
  EXCEPTION
    WHEN insufficient_privilege THEN failed := (SQLERRM LIKE '%row-level security%');
    WHEN foreign_key_violation THEN failed := false; -- reached the FK: RLS let it through
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2m a deleted account was not refused by RLS (signals)'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES (ghost, c);
  EXCEPTION
    WHEN insufficient_privilege THEN failed := (SQLERRM LIKE '%row-level security%');
    WHEN foreign_key_violation THEN failed := false;
  END;
  IF NOT failed THEN _bad := _bad || E'\n  G2m a deleted account was not refused by RLS (mute)'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- G3 · the purge runs.
  PERFORM public.purge_feed_signals(1);

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261018_0001:%', _bad;
  END IF;

  -- G4 · NOTICE: volume (the test rows above are counted here and then rolled back).
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours')
    INTO _h, _d FROM public.feed_signal_events;
  RAISE NOTICE 'PROBE PASS 20261018_0001 (lane %): RLS own-rows-only on 5 tables (B read 0 of A''s rows; B''s DELETE removed nothing of A''s; anon refused; deleted account refused); exactly once (signals resend → same 5 rows, dwell 1500 / watch 40 / 1 skip / 1 share / 1 visit; hide x2 → 1; mute x2 → 1); own profile skipped; private post %; CHECK bounds held. Ledger: % last hour, % last 24 h (purge capacity 2.4 M/day); total size: ledger %, post %, author %, hidden %, muted %',
    current_setting('p32.lane'), CASE WHEN q IS NULL THEN 'not tested (none on this lane)' ELSE 'skipped' END, _h, _d,
    pg_size_pretty(pg_total_relation_size('public.feed_signal_events')),
    pg_size_pretty(pg_total_relation_size('public.feed_post_signals')),
    pg_size_pretty(pg_total_relation_size('public.feed_author_signals')),
    pg_size_pretty(pg_total_relation_size('public.feed_hidden_posts')),
    pg_size_pretty(pg_total_relation_size('public.feed_muted_authors'));
END
$probe$;
ROLLBACK;
