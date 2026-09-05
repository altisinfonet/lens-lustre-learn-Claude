-- F-93 · unit 4b — STAGING TEST DATA. Runs BEFORE the backfill, deliberately.
--
-- ⚠ WHY THIS EXISTS, AND WHY IT IS ITS OWN STEP RATHER THAN BURIED IN THE RUN.
-- Staging held 513 profiles and every one of them was a tidy two-word ASCII
-- name. Non-Latin: ZERO. Bengali: ZERO. Cyrillic: ZERO. Single-word: ZERO.
-- Running the generator against that data would have passed 513 of 513 and
-- proved NOTHING — the transliteration path would never execute, the
-- reserved-word collision path needs a single-word name and there were none,
-- and the empty-after-reduction path could not fire. A green that cannot go
-- red is not evidence. That is C-34 applied to the FIXTURE rather than to the
-- test, and it is the failure mode that is hardest to see, because everything
-- looks green.
--
-- ⚠ THESE INSERT INTO auth.users, NOT INTO profiles, ON PURPOSE. The trigger
-- on_auth_user_created -> handle_new_user() is what really runs at signup, so
-- inserting here exercises the actual join path rather than a simulation of
-- it. The profiles rows, and their custom_urls, are produced by the same
-- triggers a real member would hit.
--
-- ⚠ STAGING ONLY. Never apply this to production: it fabricates accounts.
--
-- ⚠ DOES NOT TOUCH sofia.duarte OR yuki.tanabe. Those two are cited in the
-- F-85/F-86 evidence and moving them would invalidate a proof already written.
-- Every id below is derived from a fixture namespace that cannot collide with
-- a real account, and the inserts are ON CONFLICT DO NOTHING so re-running is
-- idempotent.

DO $fixture$
DECLARE
  _ns    constant text := 'f93-hard-cases-20260905';
  _r     record;
  _id    uuid;
  _made  int := 0;
BEGIN
  IF current_setting('server_version_num')::int < 130000 THEN
    RAISE EXCEPTION 'unexpected server version';
  END IF;

  FOR _r IN
    SELECT * FROM (VALUES
      -- ── the Owner's two acceptance criteria, verbatim ──────────────────
      ( 1, 'নীল বসু',                                   'Owner criterion 1 -> nil.basu'),
      ( 2, 'শীর্ষেন্দু দত্ত',                          'Owner criterion 2 -> shirshendu.dutta'),
      -- ── the other five scripts we map ──────────────────────────────────
      ( 3, 'Владимир Наталья',                          'Cyrillic — production has one real member'),
      ( 4, 'नील शर्मा',                                  'Devanagari'),
      ( 5, 'தமிழ் செல்வன்',                            'Tamil'),
      ( 6, 'రామ కృష్ణ',                                 'Telugu'),
      ( 7, 'નીલ પટેલ',                                  'Gujarati'),
      -- ── reserved-route collisions (both are real surnames) ─────────────
      ( 8, 'Page',                                      'single word, collides with route /page'),
      ( 9, 'Post',                                      'single word, collides with route /post'),
      -- ── differ only by case ────────────────────────────────────────────
      (10, 'Rowan Vale',                                'case pair A'),
      (11, 'ROWAN VALE',                                'case pair B — must not collide as a duplicate'),
      -- ── identical names, to force the digit-suffix rule ────────────────
      (12, 'Harper Quinn',                              'duplicate pair A'),
      (13, 'Harper Quinn',                              'duplicate pair B — must receive a digit suffix'),
      -- ── punctuation shapes ─────────────────────────────────────────────
      (14, 'Siobhan O''Connor',                         'apostrophe'),
      (15, 'Jean-Luc Picard',                           'hyphen'),
      (16, 'Zoë Müller',                                'accented Latin'),
      (17, 'Bartholomew Featherstonehaugh Fitzwilliam', 'very long, must fit 30 chars'),
      -- ── the empty path ─────────────────────────────────────────────────
      (18, '...---...',                                 'only punctuation -> member.<hex>'),
      (19, '🙂🎈',                                       'only emoji -> member.<hex>'),
      -- ── deliberately unmapped script ───────────────────────────────────
      (20, '李明',                                       'Han — not mapped by design -> member.<hex>')
    ) v(n, full_name, why)
  LOOP
    _id := md5(_ns || ':' || _r.n::text)::uuid;

    INSERT INTO auth.users (
      id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      _id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'f93-fixture-' || _r.n || '@50mm-staging-fixture.invalid',
      crypt('f93-fixture-not-a-real-login', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', _r.full_name, 'f93_fixture', _r.why),
      now(), now()
    )
    ON CONFLICT (id) DO NOTHING;

    IF FOUND THEN _made := _made + 1; END IF;
  END LOOP;

  RAISE NOTICE 'F-93 fixture: % new auth.users rows (idempotent; re-runs add nothing)', _made;

  -- A name with NO name at all cannot be expressed above, because the VALUES
  -- list is NOT NULL. It is the branch some OAuth providers actually take, so
  -- it gets its own insert with full_name absent from the metadata entirely —
  -- absent, not empty, which is the distinction that matters.
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    md5(_ns || ':21')::uuid, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'f93-fixture-21@50mm-staging-fixture.invalid',
    crypt('f93-fixture-not-a-real-login', gen_salt('bf')), now(),
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{"f93_fixture":"NO full_name key at all — the OAuth branch"}'::jsonb,
    now(), now()
  ) ON CONFLICT (id) DO NOTHING;
END
$fixture$;
