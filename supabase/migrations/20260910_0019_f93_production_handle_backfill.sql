-- ═══════════════════════════════════════════════════════════════════════════
-- F-93 · PRODUCTION HANDLE BACKFILL — the last 17 members get a name-URL.
--
-- Owner's authorisation, verbatim: "go ahead with your suggestion", and on the
-- duplicate name: "Partha Kar can me 1M in the same name, your naming policy is
-- right. go on nothing to worry".
--
-- ONE STATEMENT OF INTENT: set custom_url on exactly the rows where it IS NULL.
-- No DDL. No function is created, replaced or dropped. No other column is
-- written. No row is inserted or deleted.
--
-- ⚠ IDS ARE DERIVED, NEVER PASTED. Every id is resolved here by matching the
-- STORED full_name among rows with custom_url IS NULL. An id copied out of a
-- chat message is a value nobody can re-check; a derivation is one anybody can
-- re-run. If any name matches a number of rows other than the number planned
-- for it, this file RAISES and the whole transaction is discarded.
--
-- ⚠ THE NAMES ARE NOT ALL STORED IN LATIN SCRIPT, AND THAT IS WHY THE
--   DERIVATION IS NOT OPTIONAL. The brief named two members as "Sasha Brazhkin"
--   and "Shirshendu Dutta". Production stores 'Саша Бражкин' and
--   'শীর্ষেন্দু দত্ত'. Matching the Latin forms would have matched ZERO rows for
--   both — and, in a version without the count assertion, would have silently
--   skipped them while reporting success on the rest. A SILENT PARTIAL. The
--   handle is still the Latin one approved; only the LOOKUP KEY is the stored
--   value. 'শীর্ষেন্দু দত্ত' remains in the plan below and carries that lesson.
--
-- ⚠ SEVENTEEN, NOT EIGHTEEN — THE SET MOVED AGAIN. When this file was first
--   written production held 117 profiles and 18 without a handle. Re-measured
--   before opening the PR: 116 and 17. The profile for 'Саша Бражкин' has been
--   DELETED — not renamed and not given a handle. Verified: zero rows carry
--   that name with any handle, zero carry the surname in any form, the mirror
--   is consistent at 116/116 with no orphan, and 'sasha.brazhkin' is unused.
--   That row is removed from the plan. This is the third time in one day the
--   handle-less set has moved underneath a plan written against it, which is
--   the whole argument for A3: a plan is only safe if it refuses to run when
--   the set no longer matches it.
--
-- ⚠ THE TRIGGER THAT WOULD OTHERWISE ABORT ROW ONE. public.profiles carries
--   block_custom_url_update, BEFORE UPDATE WHEN (old.custom_url IS DISTINCT
--   FROM new.custom_url), running prevent_direct_custom_url_update(), whose
--   body is exactly:
--       IF current_setting('app.allow_custom_url_update', true) = 'true'
--         THEN RETURN NEW;
--       END IF;
--       RAISE EXCEPTION 'Direct custom_url update is not allowed...';
--   NULL → value IS DISTINCT, so it fires on every row of this backfill. The
--   set_config below is is_local = true, so it lives for this transaction only
--   and cannot leak to another session through the pooler (F-78).
--
-- ⚠ WHAT ELSE FIRES, read from pg_trigger on production rather than assumed.
--   Twelve non-internal triggers sit on public.profiles. Six fire on a
--   custom_url-only UPDATE. Four are no-ops here (protect_admin_name and
--   trg_guard_profile_moderation guard on columns this does not touch;
--   trg_validate_profile_full_name raises only on a blank name, and none of the
--   17 is blank; trg_forbid_custom_url_change is guarded by OLD.custom_url IS
--   NOT NULL). The fifth is the block above. The sixth WRITES:
--   sync_profiles_public_data_trg upserts into public.profiles_public_data and
--   its ON CONFLICT DO UPDATE SET carries custom_url, so the handle propagates
--   there automatically — which matters, because dashboard-init reads
--   profiles_public_data, not profiles, for the winners row and the voting
--   photographers. Asserted below on BOTH tables.
--
-- ⚠ LANE. This is a one-time PRODUCTION data migration. Run against any lane
--   where the 17 names are not present-and-NULL it will RAISE and roll back,
--   which is the intended behaviour, not an accident to be worked around.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SELECT set_config('app.allow_custom_url_update', 'true', true);

-- ── SNAPSHOT: the 99 handles that already exist, to prove none of them moves ──
CREATE TEMP TABLE _before_handles ON COMMIT DROP AS
  SELECT id, custom_url FROM public.profiles WHERE custom_url IS NOT NULL;

CREATE TEMP TABLE _before_counts ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM public.profiles)                                  AS profiles_total,
         (SELECT count(*) FROM public.profiles WHERE custom_url IS NULL)         AS null_rows,
         (SELECT count(*) FROM public.profiles WHERE custom_url IS NOT NULL)     AS held_rows,
         (SELECT count(*) FROM public.custom_url_history)                        AS history_rows;

-- ── THE PLAN: stored full_name → handle, with nth for the duplicate name ──
CREATE TEMP TABLE _plan (full_name text, nth int, handle text) ON COMMIT DROP;
INSERT INTO _plan (full_name, nth, handle) VALUES
  ('Sujay Kumar Sil',           1, 'sujay.sil'),
  ('Ritam Dey',                 1, 'ritam.dey'),
  ('Sk Sujay',                  1, 'sk.sujay'),
  ('Debraj Biswas',             1, 'debraj.biswas'),
  ('Saumyadip Bhowmick',        1, 'saumyadip.bhowmick'),
  ('Mrinmoy Das',               1, 'mrinmoy.das'),
  ('Dipankar Mondal',           1, 'dipankar.mondal'),
  ('Ayan Mukherjee',            1, 'ayan.mukherjee'),
  ('Shyama Prasad Chakraborty', 1, 'shyama.chakraborty'),
  ('Samiran',                   1, 'samiran'),
  ('Solomon Bekele',            1, 'solomon.bekele'),
  ('Udayan Joarder',            1, 'udayan.joarder'),
  ('Aniket Pal',                1, 'aniket.pal'),
  ('শীর্ষেন্দু দত্ত',              1, 'shirshendu.dutta'),
  ('Anjan Sen',                 1, 'anjan.sen'),
  ('Partha Kar',                1, 'partha.kar'),
  ('Partha Kar',                2, 'partha.kar2');

-- A1 · The plan itself is well-formed: 17 rows, 17 distinct handles.
DO $a1$
DECLARE _n int; _d int;
BEGIN
  SELECT count(*), count(DISTINCT handle) INTO _n, _d FROM _plan;
  IF _n <> 17 OR _d <> 17 THEN
    RAISE EXCEPTION 'A1 FAILED — plan holds % rows and % distinct handles; expected 17 and 17.', _n, _d;
  END IF;
END
$a1$;

-- A2 · Every planned name matches EXACTLY the number of NULL rows planned for
--      it. One for FIFTEEN names, two for Partha Kar — 15 + 2 = 17, which is
--      where the seventeen comes from. Anything else aborts.
DO $a2$
DECLARE r record; _expected int; _actual int;
BEGIN
  FOR r IN SELECT DISTINCT full_name FROM _plan LOOP
    SELECT count(*) INTO _expected FROM _plan WHERE full_name = r.full_name;
    SELECT count(*) INTO _actual
      FROM public.profiles
     WHERE custom_url IS NULL AND full_name = r.full_name;
    IF _actual <> _expected THEN
      RAISE EXCEPTION
        'A2 FAILED — name % matches % handle-less row(s); the plan expects %. Nothing has been written; the transaction is discarded. Either the member has claimed a handle, a namesake signed up, or the stored spelling differs from the plan.',
        quote_literal(r.full_name), _actual, _expected;
    END IF;
  END LOOP;
END
$a2$;

-- A3 · No handle-less row is left OUT of the plan. A2 proves the plan's names
--      are right; A3 proves the plan is complete. Without it, a member who
--      joined since the plan was written is silently skipped.
DO $a3$
DECLARE _orphans text;
BEGIN
  SELECT string_agg(quote_literal(p.full_name), ', ') INTO _orphans
    FROM public.profiles p
   WHERE p.custom_url IS NULL
     AND NOT EXISTS (SELECT 1 FROM _plan pl WHERE pl.full_name = p.full_name);
  IF _orphans IS NOT NULL THEN
    RAISE EXCEPTION
      'A3 FAILED — handle-less rows exist that the plan does not name: %. The set moved after the plan was written. Nothing written.', _orphans;
  END IF;
END
$a3$;

-- A4 · Every planned handle is free right now. The Auditor verified this
--      minutes before the file was written; it is re-verified here because a
--      claim made outside the transaction is not a claim inside it.
DO $a4$
DECLARE _taken text;
BEGIN
  SELECT string_agg(pl.handle, ', ') INTO _taken
    FROM _plan pl
   WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.custom_url = pl.handle);
  IF _taken IS NOT NULL THEN
    RAISE EXCEPTION 'A4 FAILED — these handles are already held: %. Nothing written.', _taken;
  END IF;
END
$a4$;

-- ── RESOLVE IDS: rank the handle-less rows per name by created_at ──
CREATE TEMP TABLE _resolved ON COMMIT DROP AS
  SELECT r.id, r.full_name, r.created_at, pl.handle
    FROM (
      SELECT p.id, p.full_name, p.created_at,
             row_number() OVER (PARTITION BY p.full_name ORDER BY p.created_at, p.id) AS nth
        FROM public.profiles p
       WHERE p.custom_url IS NULL
    ) r
    JOIN _plan pl ON pl.full_name = r.full_name AND pl.nth = r.nth;

-- A5 · 17 rows resolved, 17 distinct ids, 17 distinct handles.
DO $a5$
DECLARE _n int; _di int; _dh int;
BEGIN
  SELECT count(*), count(DISTINCT id), count(DISTINCT handle) INTO _n, _di, _dh FROM _resolved;
  IF _n <> 17 OR _di <> 17 OR _dh <> 17 THEN
    RAISE EXCEPTION 'A5 FAILED — resolved % rows, % distinct ids, % distinct handles; expected 17/17/17.', _n, _di, _dh;
  END IF;
END
$a5$;

-- A6 · The duplicate name is ordered the way the Owner ruled: the older account
--      takes the bare handle, the newer takes the digit. Pinned by DATE so a
--      silent re-ordering cannot pass.
DO $a6$
DECLARE _d1 date; _d2 date;
BEGIN
  SELECT created_at::date INTO _d1 FROM _resolved WHERE handle = 'partha.kar';
  SELECT created_at::date INTO _d2 FROM _resolved WHERE handle = 'partha.kar2';
  IF _d1 <> DATE '2026-09-05' OR _d2 <> DATE '2026-09-06' THEN
    RAISE EXCEPTION
      'A6 FAILED — partha.kar resolved to the account created % and partha.kar2 to %; the ruling is 2026-09-05 → partha.kar, 2026-09-06 → partha.kar2.', _d1, _d2;
  END IF;
  IF _d2 <= _d1 THEN
    RAISE EXCEPTION 'A6 FAILED — the digit suffix did not go to the newer account.';
  END IF;
END
$a6$;

-- ── THE WRITE. One statement, one column, 17 rows. ──
UPDATE public.profiles p
   SET custom_url = r.handle
  FROM _resolved r
 WHERE p.id = r.id
   AND p.custom_url IS NULL;

-- A7 · Exactly 17 rows changed.
DO $a7$
DECLARE _still_null int; _held int; _total int;
BEGIN
  SELECT count(*) INTO _still_null FROM public.profiles WHERE custom_url IS NULL;
  SELECT count(*) INTO _held       FROM public.profiles WHERE custom_url IS NOT NULL;
  SELECT count(*) INTO _total      FROM public.profiles;
  IF _still_null <> 0 THEN
    RAISE EXCEPTION 'A7 FAILED — % rows still have no handle. HAVE NONE must be zero.', _still_null;
  END IF;
  IF _held <> (SELECT held_rows + 17 FROM _before_counts) THEN
    RAISE EXCEPTION 'A7 FAILED — handles held went from % to %, not +17.',
      (SELECT held_rows FROM _before_counts), _held;
  END IF;
  IF _total <> (SELECT profiles_total FROM _before_counts) THEN
    RAISE EXCEPTION 'A7 FAILED — the profile count changed from % to %. This migration must create and delete nothing.',
      (SELECT profiles_total FROM _before_counts), _total;
  END IF;
END
$a7$;

-- A8 · THE 99 EXISTING HANDLES ARE BYTE-IDENTICAL. Set comparison both ways, so
--      a changed value, a moved value and a lost row are all caught.
DO $a8$
DECLARE _drift int;
BEGIN
  SELECT count(*) INTO _drift FROM (
    (SELECT id, custom_url FROM _before_handles
     EXCEPT
     SELECT id, custom_url FROM public.profiles WHERE custom_url IS NOT NULL)
    UNION ALL
    (SELECT p.id, p.custom_url FROM public.profiles p
      WHERE p.custom_url IS NOT NULL
        AND p.id IN (SELECT id FROM _before_handles)
     EXCEPT
     SELECT id, custom_url FROM _before_handles)
  ) d;
  IF _drift <> 0 THEN
    RAISE EXCEPTION 'A8 FAILED — % pre-existing handle(s) differ from the snapshot. Nothing outside the 17 may change.', _drift;
  END IF;
END
$a8$;

-- A9 · No duplicate handle anywhere in the table.
DO $a9$
DECLARE _dupes text;
BEGIN
  SELECT string_agg(custom_url || ' ×' || n, ', ') INTO _dupes
    FROM (SELECT custom_url, count(*) AS n FROM public.profiles
           WHERE custom_url IS NOT NULL GROUP BY custom_url HAVING count(*) > 1) x;
  IF _dupes IS NOT NULL THEN
    RAISE EXCEPTION 'A9 FAILED — duplicate handles: %', _dupes;
  END IF;
END
$a9$;

-- A10 · The second table agrees. sync_profiles_public_data_trg carries
--       custom_url, and dashboard-init reads THAT table for the winners row and
--       the voting photographers. Zero on profiles alone is not the acceptance
--       condition.
DO $a10$
DECLARE _ppd_null int; _drift int; _missing int;
BEGIN
  SELECT count(*) INTO _ppd_null   FROM public.profiles_public_data WHERE custom_url IS NULL;
  SELECT count(*) INTO _missing    FROM public.profiles p
    LEFT JOIN public.profiles_public_data d ON d.id = p.id WHERE d.id IS NULL;
  SELECT count(*) INTO _drift      FROM public.profiles p
    JOIN public.profiles_public_data d ON d.id = p.id
   WHERE p.custom_url IS DISTINCT FROM d.custom_url;
  IF _ppd_null <> 0 OR _missing <> 0 OR _drift <> 0 THEN
    RAISE EXCEPTION
      'A10 FAILED — profiles_public_data: % null handle(s), % missing row(s), % drifted from profiles. The names would stay dead on the surfaces that read the mirror.',
      _ppd_null, _missing, _drift;
  END IF;
END
$a10$;

-- A11 · No history row was manufactured. Production carries no history trigger
--       on profiles; this proves that stayed true rather than assuming it.
DO $a11$
DECLARE _now int; _was int;
BEGIN
  SELECT count(*) INTO _now FROM public.custom_url_history;
  SELECT history_rows INTO _was FROM _before_counts;
  IF _now <> _was THEN
    RAISE EXCEPTION 'A11 FAILED — custom_url_history went from % rows to %. This migration writes one column on one table.', _was, _now;
  END IF;
END
$a11$;

COMMIT;
