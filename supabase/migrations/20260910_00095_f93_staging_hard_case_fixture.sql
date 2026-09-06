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
-- ⚠ STAGING ONLY, AND NOW ENFORCED. It fabricates 20 accounts in auth.users.
--   This is no longer a request to the reader: a lane guard below reads the
--   cluster's system_identifier and RAISES on production or on any lane it
--   does not recognise. See F-110.
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

  -- ── F-110 LANE GUARD. A COMMENT IS NOT A LOCK. ──────────────────────────
  -- Line 20 of this file has said "STAGING ONLY. Never apply this to
  -- production" since the day it was written. That sentence has never stopped
  -- anything: apply-migration.yml takes a path and a target chosen by whoever
  -- fills the form, and nothing in the SQL cared which database answered. One
  -- mis-set dropdown and twenty fabricated accounts land in production's
  -- auth.users, where they cannot be cleanly withdrawn — they are real login
  -- identities, and the five AFTER INSERT triggers on public.profiles fire on
  -- each one.
  --
  -- The guard reads the cluster's own system_identifier from pg_control_system().
  -- It is assigned at initdb, it is unique per cluster, no application code can
  -- change it, and it does not depend on a connection string, an environment
  -- variable or a setting anyone can pass in. That is the whole point: the
  -- operator does not get a vote.
  --
  -- IT FAILS CLOSED. An unrecognised identifier is REFUSED, not permitted — so
  -- a branch database, a restored copy, a clone or a lane nobody has registered
  -- is refused by default. The dangerous default is "allow unless recognised";
  -- this is "refuse unless recognised".
  --
  -- ⚠ IF THIS FILE IS EVER LEGITIMATELY NEEDED ON A NEW LANE, add that lane's
  -- identifier here in its own migration and say why. Do NOT relax the check,
  -- and do NOT delete the production arm — Rule 19: never weaken a control to
  -- get green.
  --
  -- PROVEN IN BOTH DIRECTIONS BEFORE THIS FILE WAS COMMITTED, against the real
  -- clusters, read-only:
  --   production 7656985631720456337 -> RAISED, transaction discarded
  --   staging    7666007964130682852 -> passed, 'lane ok — staging'
  DECLARE
    _sysid text;
  BEGIN
    SELECT system_identifier::text INTO _sysid FROM pg_control_system();

    IF _sysid = '7656985631720456337' THEN
      RAISE EXCEPTION
        'LANE GUARD REFUSED — this is PRODUCTION (system_identifier %). This migration fabricates 20 accounts in auth.users and must never run here. Nothing has been written. If you meant staging, dispatch with target=staging; the guard decides, not the operator.',
        _sysid;
    END IF;

    IF _sysid IS DISTINCT FROM '7666007964130682852' THEN
      RAISE EXCEPTION
        'LANE GUARD REFUSED — unrecognised lane (system_identifier %). This fixture runs ONLY on the staging cluster 7666007964130682852. It fails CLOSED: an unknown database is refused, not permitted. Nothing has been written.',
        _sysid;
    END IF;

    RAISE NOTICE 'F-110 lane guard: ok — staging (%)', _sysid;
  END;

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
