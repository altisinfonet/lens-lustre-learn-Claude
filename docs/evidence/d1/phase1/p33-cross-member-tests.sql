-- ═══════════════════════════════════════════════════════════════════════════
-- P33 · 20260910_0036 — CROSS-MEMBER AND CLOSURE TESTS
--
-- Runs on the scratch PostgreSQL 17 fixture built by p33-fixture.sql. Never on
-- staging, never on production: it SETs ROLE, applies a migration and creates
-- deliberately broken copies of production view definitions.
--
-- WHAT IT PROVES, AND WHAT IT DOES NOT
-- ────────────────────────────────────
-- Per the Auditor's ruling of 2026-09-25 (R-49/R-50, finding C-A19), the
-- cross-member tests cover judge_decisions_owner_safe and
-- judge_tag_assignments_public_r4 ONLY. judge_comments_owner_safe and
-- judge_tag_assignments_owner_safe are OPEN — they correlate competition_id
-- but not round_number, so any published round unlocks the owner's rows from
-- every round — and are fixed by 20260910_0042, not by this file. Group 0
-- below reproduces that defect rather than asserting it away, so the fixture
-- carries the evidence instead of a claim about it.
--
-- C-34: a test that could not have failed is not evidence. Every assertion in
-- groups 1 and 2 is run TWICE — once against the real view and once against a
-- deliberately loosened copy that removes exactly the clause the assertion
-- depends on. An assertion whose loosened run does not go RED is marked
-- NOT-FALSIFIABLE and is a finding, not a pass.
--
-- Group 3 does the same for the closure itself: the five direct reads are
-- taken BEFORE 0036 is applied (they succeed) and AFTER (42501), so "anon
-- cannot read it" is a change this file caused and not a state it inherited.
--
-- USAGE
--   dropdb --if-exists p33 && createdb p33
--   psql -d p33 -v ON_ERROR_STOP=1 -f docs/evidence/d1/phase1/p33-fixture.sql
--   psql -d p33 -v ON_ERROR_STOP=1 -f docs/evidence/d1/phase1/p33-cross-member-tests.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ── THE DRIVER ────────────────────────────────────────────────────────────
-- Each case runs one scalar query as one role with one caller identity, and
-- records the answer next to the expected answer. A query that is refused
-- records '42501' rather than aborting, because "refused" is an outcome this
-- suite tests for, not an error.

CREATE TABLE public.p33_results (
  seq        serial primary key,
  grp        text,
  label      text,
  subject    text,      -- the relation under test
  variant    text,      -- 'real' or the name of the loosening
  actor      text,      -- role + uid
  expected   text,
  actual     text,
  pass       boolean
);

CREATE FUNCTION public.p33_run(_grp text, _label text, _subject text, _variant text,
                               _role text, _uid text, _sql text, _expected text)
  RETURNS void LANGUAGE plpgsql AS
$drv$
DECLARE a text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', _role);
    PERFORM set_config('request.jwt.claim.sub', coalesce(_uid, ''), true);
    EXECUTE _sql INTO a;
    a := coalesce(a, '(null)');
  EXCEPTION
    WHEN insufficient_privilege THEN a := '42501';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO public.p33_results(grp, label, subject, variant, actor, expected, actual, pass)
  VALUES (_grp, _label, _subject, _variant,
          _role || coalesce(' / ' || left(_uid, 8), ' / (no uid)'),
          _expected, a, a IS NOT DISTINCT FROM _expected);
END
$drv$;

-- Member A owns entry 1111…; member B owns entry 2222…; member C owns entry
-- 3333… in the competition whose round 4 is NOT published.
\set A  aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
\set B  bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
\set EA 11111111-1111-1111-1111-111111111111
\set EB 22222222-2222-2222-2222-222222222222
\set EC 33333333-3333-3333-3333-333333333333
\set TAG_NONAWARD bbbb0000-0000-0000-0000-00000000000b

-- ── THE LOOSENED COPIES ───────────────────────────────────────────────────
-- Each removes ONE clause from the real definition and nothing else. They are
-- the falsifiers: an assertion is only evidence if it goes RED against the
-- copy that removes the clause it is testing.

--   _loose_uid: judge_decisions_owner_safe without `ce.user_id = auth.uid()`.
--   Falsifies the cross-member and anonymous assertions.
CREATE VIEW public.jdos_loose_uid AS
 SELECT entry_id, photo_index, decision, round_number
   FROM judge_decisions jd
  WHERE (EXISTS ( SELECT 1
           FROM competition_round_publish crp
             JOIN competition_entries ce ON ce.competition_id = crp.competition_id
          WHERE ce.id = jd.entry_id AND crp.round_number = jd.round_number AND crp.published_at IS NOT NULL));

--   _loose_round: judge_decisions_owner_safe without
--   `crp.round_number = jd.round_number`. This is EXACTLY the C-A19 defect,
--   applied to the view that does not have it. Falsifies the unpublished-round
--   assertion.
CREATE VIEW public.jdos_loose_round AS
 SELECT entry_id, photo_index, decision, round_number
   FROM judge_decisions jd
  WHERE (EXISTS ( SELECT 1
           FROM competition_round_publish crp
             JOIN competition_entries ce ON ce.competition_id = crp.competition_id
          WHERE ce.id = jd.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL));

--   _loose_family: judge_tag_assignments_public_r4 without the award-family
--   restriction. Falsifies "no non-award tag is returned".
CREATE VIEW public.jtapr4_loose_family AS
 SELECT id, entry_id, tag_id, photo_index, round_number, created_at
   FROM judge_tag_assignments jta
  WHERE (EXISTS ( SELECT 1
           FROM competition_entries ce
             JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
          WHERE ce.id = jta.entry_id AND crp.round_number = 4 AND crp.published_at IS NOT NULL));

--   _loose_publish: judge_tag_assignments_public_r4 without the round-4
--   publication check. Falsifies "nothing from an unpublished round 4".
CREATE VIEW public.jtapr4_loose_publish AS
 SELECT id, entry_id, tag_id, photo_index, round_number, created_at
   FROM judge_tag_assignments jta
  WHERE (EXISTS ( SELECT 1
           FROM judging_tags jt
             JOIN v3_stage_catalog sc ON sc.tag_label_canonical = jt.label
          WHERE jt.id = jta.tag_id AND sc.family = 'award'::text AND sc.round_number = 4 AND sc.is_active));

GRANT SELECT ON public.jdos_loose_uid, public.jdos_loose_round,
                 public.jtapr4_loose_family, public.jtapr4_loose_publish
  TO anon, authenticated;

-- ══ GROUP 0 — THE OPEN DEFECT, REPRODUCED (C-A19) ═════════════════════════
-- Not an assertion about correct behaviour. A measurement of the two views the
-- ruling leaves OPEN, next to the view that gets it right, on identical data:
-- member A's round-3 rows, in a competition whose round 3 is NOT published.
--   judge_decisions_owner_safe     correlates the round  → 0 rows  (correct)
--   judge_tag_assignments_owner_safe  does not           → 1 row   (the leak)
-- Both "expected" values below record what IS true today, so group 0 turning
-- GREEN is the defect still being present and group 0 turning RED after 0042
-- is the fix landing.

SELECT public.p33_run('0','unpublished round 3 leaks — CORRECT view',
  'judge_decisions_owner_safe','real','authenticated',:'A',
  'SELECT count(*)::text FROM public.judge_decisions_owner_safe WHERE round_number = 3', '0');

SELECT public.p33_run('0','unpublished round 3 leaks — OPEN, fixed by 0042',
  'judge_tag_assignments_owner_safe','real','authenticated',:'A',
  'SELECT count(*)::text FROM public.judge_tag_assignments_owner_safe WHERE round_number = 3', '1');

-- ══ GROUP 1 — judge_decisions_owner_safe ══════════════════════════════════
-- as A: A's published-round rows only, never B's, never an unpublished round.
-- as B: the mirror. as anon: nothing.

-- 1.1 — as A, exactly A's published round-1 decision, by content.
SELECT public.p33_run('1','as A: sees own published rows',
  'judge_decisions_owner_safe','real','authenticated',:'A',
  'SELECT coalesce(string_agg(decision, '','' ORDER BY decision), ''(none)'') FROM public.judge_decisions_owner_safe',
  'A R1 PUBLISHED');

-- 1.2 — as A, none of B's rows. Falsified by _loose_uid.
SELECT public.p33_run('1','as A: sees none of B''s rows',
  'judge_decisions_owner_safe','real','authenticated',:'A',
  'SELECT count(*)::text FROM public.judge_decisions_owner_safe WHERE entry_id = ' || quote_literal(:'EB'), '0');
SELECT public.p33_run('1','as A: sees none of B''s rows',
  'judge_decisions_owner_safe','loose_uid','authenticated',:'A',
  'SELECT count(*)::text FROM public.jdos_loose_uid WHERE entry_id = ' || quote_literal(:'EB'), '0');

-- 1.3 — as A, nothing from the unpublished round 3. Falsified by _loose_round.
SELECT public.p33_run('1','as A: nothing from unpublished round 3',
  'judge_decisions_owner_safe','real','authenticated',:'A',
  'SELECT count(*)::text FROM public.judge_decisions_owner_safe WHERE round_number = 3', '0');
SELECT public.p33_run('1','as A: nothing from unpublished round 3',
  'judge_decisions_owner_safe','loose_round','authenticated',:'A',
  'SELECT count(*)::text FROM public.jdos_loose_round WHERE round_number = 3', '0');

-- 1.4 — as B, the mirror of 1.1.
SELECT public.p33_run('1','as B: sees own published rows',
  'judge_decisions_owner_safe','real','authenticated',:'B',
  'SELECT coalesce(string_agg(decision, '','' ORDER BY decision), ''(none)'') FROM public.judge_decisions_owner_safe',
  'B R1 PUBLISHED');

-- 1.5 — as B, none of A's rows. Falsified by _loose_uid.
SELECT public.p33_run('1','as B: sees none of A''s rows',
  'judge_decisions_owner_safe','real','authenticated',:'B',
  'SELECT count(*)::text FROM public.judge_decisions_owner_safe WHERE entry_id = ' || quote_literal(:'EA'), '0');
SELECT public.p33_run('1','as B: sees none of A''s rows',
  'judge_decisions_owner_safe','loose_uid','authenticated',:'B',
  'SELECT count(*)::text FROM public.jdos_loose_uid WHERE entry_id = ' || quote_literal(:'EA'), '0');

-- 1.6 — as anon with no uid at all, zero rows. Falsified by _loose_uid.
SELECT public.p33_run('1','as anon (no uid): zero rows',
  'judge_decisions_owner_safe','real','anon',NULL,
  'SELECT count(*)::text FROM public.judge_decisions_owner_safe', '0');
SELECT public.p33_run('1','as anon (no uid): zero rows',
  'judge_decisions_owner_safe','loose_uid','anon',NULL,
  'SELECT count(*)::text FROM public.jdos_loose_uid', '0');

-- ══ GROUP 2 — judge_tag_assignments_public_r4 ═════════════════════════════
-- anon sees the award-family tags of round-4-PUBLISHED entries and nothing
-- else. This view is public by design: seeing another member's award tag is
-- the point, so 2.1 asserts both A's and B's award rows are present.

-- 2.1 — as anon, exactly the two award tags of the published competition.
SELECT public.p33_run('2','as anon: the award R4 tags of published entries',
  'judge_tag_assignments_public_r4','real','anon',NULL,
  'SELECT coalesce(string_agg(left(id::text, 8), '','' ORDER BY id::text), ''(none)'') FROM public.judge_tag_assignments_public_r4',
  '7a000000,7b000000');

-- 2.2 — no non-award tag. Falsified by _loose_family.
-- The tag is named by id, not by joining public.judging_tags: anon has no
-- grant on that base table, so a join would raise 42501 and the loosened run
-- would go RED for a reason that has nothing to do with the award family
-- (C-34 — the first version of this case did exactly that).
--   aaaa0000… = 'Top 50', award family, round 4
--   bbbb0000… = 'Needs Work', progression_fail family, round 3
SELECT public.p33_run('2','as anon: no non-award tag',
  'judge_tag_assignments_public_r4','real','anon',NULL,
  'SELECT count(*)::text FROM public.judge_tag_assignments_public_r4
    WHERE tag_id = ' || quote_literal(:'TAG_NONAWARD'), '0');
SELECT public.p33_run('2','as anon: no non-award tag',
  'judge_tag_assignments_public_r4','loose_family','anon',NULL,
  'SELECT count(*)::text FROM public.jtapr4_loose_family
    WHERE tag_id = ' || quote_literal(:'TAG_NONAWARD'), '0');

-- 2.3 — nothing from a competition whose round 4 is not published. Falsified
-- by _loose_publish.
SELECT public.p33_run('2','as anon: nothing from an unpublished round 4',
  'judge_tag_assignments_public_r4','real','anon',NULL,
  'SELECT count(*)::text FROM public.judge_tag_assignments_public_r4 WHERE entry_id = ' || quote_literal(:'EC'), '0');
SELECT public.p33_run('2','as anon: nothing from an unpublished round 4',
  'judge_tag_assignments_public_r4','loose_publish','anon',NULL,
  'SELECT count(*)::text FROM public.jtapr4_loose_publish WHERE entry_id = ' || quote_literal(:'EC'), '0');

-- ══ GROUP 3a — THE FIVE, BEFORE 0036 ══════════════════════════════════════
-- The control for group 3b. If these do not read today, 42501 afterwards
-- proves nothing (C-34).

DO $pre$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['judging_progression_audit','v_judging_drift','entry_public_status',
                           'entry_vote_counts','entry_final_votes_legacy']
  LOOP
    PERFORM public.p33_run('3a','BEFORE 0036: anon reads it', r, 'real', 'anon', NULL,
      format('SELECT ''reads''::text FROM (SELECT count(*) FROM public.%I) x', r), 'reads');
    PERFORM public.p33_run('3a','BEFORE 0036: authenticated reads it', r, 'real', 'authenticated',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      format('SELECT ''reads''::text FROM (SELECT count(*) FROM public.%I) x', r), 'reads');
  END LOOP;
END
$pre$;

-- ══ APPLY 20260910_0036 ═══════════════════════════════════════════════════
-- Through the same lane assertion the dispatch workflow sets (R-13). The
-- fixture is a scratch cluster, so 'staging' is the honest value: this is a
-- rehearsal of the staging lane.
SET p32.lane = 'staging';
\ir ../../../../supabase/migrations/20260910_0036_p33_definer_view_read_closure.sql
RESET p32.lane;

-- ══ GROUP 3b — THE FIVE, AFTER 0036 ═══════════════════════════════════════
-- Direct reads refused; a SECURITY DEFINER wrapper — the stand-in for
-- get_judging_drift_admin, get_entry_vote_counts and the eight
-- entry_public_status readers — still reads; service_role still reads.

DO $post$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['judging_progression_audit','v_judging_drift','entry_public_status',
                           'entry_vote_counts','entry_final_votes_legacy']
  LOOP
    PERFORM public.p33_run('3b','AFTER 0036: anon direct read refused', r, 'real', 'anon', NULL,
      format('SELECT ''reads''::text FROM (SELECT count(*) FROM public.%I) x', r), '42501');
    PERFORM public.p33_run('3b','AFTER 0036: authenticated direct read refused', r, 'real', 'authenticated',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      format('SELECT ''reads''::text FROM (SELECT count(*) FROM public.%I) x', r), '42501');
    PERFORM public.p33_run('3b','AFTER 0036: DEFINER wrapper still reads', r, 'real', 'anon', NULL,
      format('SELECT ''reads''::text FROM (SELECT public.definer_read_probe(%L)) x', r), 'reads');
    PERFORM public.p33_run('3b','AFTER 0036: service_role still reads', r, 'real', 'service_role', NULL,
      format('SELECT ''reads''::text FROM (SELECT count(*) FROM public.%I) x', r), 'reads');
  END LOOP;
END
$post$;

-- ══ GROUP 4 — THE SIX KEPT RELATIONS STILL READ ═══════════════════════════
-- 0036 must not close a door it did not name.

DO $kept$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['judge_comments_owner_safe','judge_decisions_owner_safe',
                           'judge_tag_assignments_owner_safe','judge_tag_assignments_public_r4',
                           'profiles_public','entry_final_votes']
  LOOP
    PERFORM public.p33_run('4','AFTER 0036: KEPT, anon still reads', r, 'real', 'anon', NULL,
      format('SELECT ''reads''::text FROM (SELECT count(*) FROM public.%I) x', r), 'reads');
    PERFORM public.p33_run('4','AFTER 0036: KEPT, authenticated still reads', r, 'real', 'authenticated',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      format('SELECT ''reads''::text FROM (SELECT count(*) FROM public.%I) x', r), 'reads');
  END LOOP;
END
$kept$;

-- ══ THE REPORT ════════════════════════════════════════════════════════════

\echo ''
\echo '── RESULTS ──────────────────────────────────────────────────────────────'
\pset border 2
SELECT seq, grp, subject, variant, actor, expected, actual,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, label
  FROM public.p33_results ORDER BY seq;

\echo ''
\echo '── FALSIFIABILITY (C-34): every loosened run MUST fail ──────────────────'
SELECT r.subject, r.label, r.variant,
       CASE WHEN r.pass THEN 'NOT FALSIFIABLE — FINDING' ELSE 'RED as required' END AS verdict
  FROM public.p33_results r WHERE r.variant <> 'real' ORDER BY r.seq;

\echo ''
\echo '── SUMMARY ──────────────────────────────────────────────────────────────'
SELECT
  count(*) FILTER (WHERE variant = 'real')                          AS real_runs,
  count(*) FILTER (WHERE variant = 'real' AND pass)                 AS real_pass,
  count(*) FILTER (WHERE variant = 'real' AND NOT pass)             AS real_fail,
  count(*) FILTER (WHERE variant <> 'real')                         AS loosened_runs,
  count(*) FILTER (WHERE variant <> 'real' AND NOT pass)            AS loosened_red,
  count(*) FILTER (WHERE variant <> 'real' AND pass)                AS loosened_not_falsifiable
  FROM public.p33_results;

DO $verdict$
DECLARE bad_real int; bad_loose int;
BEGIN
  SELECT count(*) INTO bad_real  FROM public.p33_results WHERE variant = 'real'  AND NOT pass;
  SELECT count(*) INTO bad_loose FROM public.p33_results WHERE variant <> 'real' AND pass;
  IF bad_real > 0 OR bad_loose > 0 THEN
    RAISE EXCEPTION 'P33 TESTS FAILED — % real assertion(s) failed, % loosened run(s) did not go RED',
      bad_real, bad_loose USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P33 TESTS GREEN — every real assertion held and every loosened copy was caught.';
END
$verdict$;
