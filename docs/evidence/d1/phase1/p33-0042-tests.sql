-- ═══════════════════════════════════════════════════════════════════════════
-- P33 · 20260910_0042 — C-A19 TESTS
--
-- Runs on the scratch PostgreSQL 17 fixture built by p33-0042-fixture.sql.
-- Never on staging, never on production: it SETs ROLE and applies a migration.
--
-- THE STRUCTURE IS BEFORE / AFTER, not AFTER alone.
--
-- Every assertion about the fixed views is taken twice against the SAME data
-- and the SAME caller: once with the pre-0042 definitions in place, once
-- after. The BEFORE half is the control and it is expected to be WRONG — that
-- is what finding C-A19 is. An "AFTER" number on its own would not show that
-- this file changed anything (C-34: a test that could not have failed is not
-- evidence).
--
-- The fixture's data is arranged so that each clause of the new correlation
-- has a row that only it excludes:
--   the published-round clause  -> A's C-round-3 comment and tag
--   the NULL round_id case      -> A's comment with no round
--   the competition clause      -> A's comment pointing at competition D's
--                                  round 1, which IS published, in a
--                                  competition A has no entry in
--   the owner clause            -> B's comment and tag
--
--   psql -d p42 -v ON_ERROR_STOP=1 -f docs/evidence/d1/phase1/p33-0042-fixture.sql
--   psql -d p42 -v ON_ERROR_STOP=1 -f docs/evidence/d1/phase1/p33-0042-tests.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

CREATE TABLE public.p42_results (
  seq serial primary key, phase text, label text, subject text,
  actor text, expected text, actual text, pass boolean);

CREATE FUNCTION public.p42_run(_phase text, _label text, _subject text,
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
  EXCEPTION WHEN insufficient_privilege THEN a := '42501';
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO public.p42_results(phase, label, subject, actor, expected, actual, pass)
  VALUES (_phase, _label, _subject,
          _role || coalesce(' / ' || left(_uid, 8), ' / (no uid)'),
          _expected, a, a IS NOT DISTINCT FROM _expected);
END
$drv$;

-- Every case, run once per phase. Keeping them in one function means the
-- BEFORE and AFTER halves cannot drift apart into two different tests.
CREATE FUNCTION public.p42_suite(_phase text, _exp_a_comments text, _exp_a_tags text)
  RETURNS void LANGUAGE plpgsql AS
$s$
DECLARE
  A text := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  B text := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
  -- What member A can read of their OWN comments, by content, sorted.
  PERFORM public.p42_run(_phase, 'as A: own comments', 'judge_comments_owner_safe',
    'authenticated', A,
    'SELECT coalesce(string_agg(comment, '' | '' ORDER BY comment), ''(none)'')
       FROM public.judge_comments_owner_safe', _exp_a_comments);

  -- The same for tags, by round number.
  PERFORM public.p42_run(_phase, 'as A: own tag rounds', 'judge_tag_assignments_owner_safe',
    'authenticated', A,
    'SELECT coalesce(string_agg(round_number::text, '','' ORDER BY round_number), ''(none)'')
       FROM public.judge_tag_assignments_owner_safe', _exp_a_tags);

  -- The reference implementation, unchanged by this file either way.
  PERFORM public.p42_run(_phase, 'as A: decisions (out of scope, must not move)',
    'judge_decisions_owner_safe', 'authenticated', A,
    'SELECT coalesce(string_agg(decision, '' | '' ORDER BY decision), ''(none)'')
       FROM public.judge_decisions_owner_safe', 'A R1 PUBLISHED');

  -- Cross-member: never B's rows, in either phase. The owner clause is
  -- untouched by 0042 and must stay untouched.
  PERFORM public.p42_run(_phase, 'as A: none of B''s comments', 'judge_comments_owner_safe',
    'authenticated', A,
    'SELECT count(*)::text FROM public.judge_comments_owner_safe
      WHERE entry_id = ''22222222-2222-2222-2222-222222222222''', '0');
  PERFORM public.p42_run(_phase, 'as A: none of B''s tags', 'judge_tag_assignments_owner_safe',
    'authenticated', A,
    'SELECT count(*)::text FROM public.judge_tag_assignments_owner_safe
      WHERE entry_id = ''22222222-2222-2222-2222-222222222222''', '0');
  PERFORM public.p42_run(_phase, 'as B: only B''s comment', 'judge_comments_owner_safe',
    'authenticated', B,
    'SELECT coalesce(string_agg(comment, '' | '' ORDER BY comment), ''(none)'')
       FROM public.judge_comments_owner_safe', 'B C-R1 PUBLISHED');

  -- Anonymous, no uid: nothing, in either phase.
  PERFORM public.p42_run(_phase, 'as anon (no uid): no comments', 'judge_comments_owner_safe',
    'anon', NULL, 'SELECT count(*)::text FROM public.judge_comments_owner_safe', '0');
  PERFORM public.p42_run(_phase, 'as anon (no uid): no tags', 'judge_tag_assignments_owner_safe',
    'anon', NULL, 'SELECT count(*)::text FROM public.judge_tag_assignments_owner_safe', '0');

  -- service_role still reads: 0042 changes definitions, not grants.
  PERFORM public.p42_run(_phase, 'service_role still reads comments', 'judge_comments_owner_safe',
    'service_role', NULL,
    'SELECT ''reads''::text FROM (SELECT count(*) FROM public.judge_comments_owner_safe) x', 'reads');
  PERFORM public.p42_run(_phase, 'service_role still reads tags', 'judge_tag_assignments_owner_safe',
    'service_role', NULL,
    'SELECT ''reads''::text FROM (SELECT count(*) FROM public.judge_tag_assignments_owner_safe) x', 'reads');
END
$s$;

-- ══ BEFORE — the pre-0042 definitions. THESE NUMBERS ARE THE DEFECT. ══════
-- A sees all four of their comments and both of their tags because
-- competition C has one published round. The C-round-3 comment and tag are
-- from a round still being judged; the NULL-round comment has no round at all;
-- the fourth comment belongs to a round of a DIFFERENT competition.
SELECT public.p42_suite('BEFORE',
  'A C-R1 PUBLISHED | A C-R3 UNPUBLISHED | A FOREIGN ROUND D-R1 | A NULL ROUND',
  '1,3');

-- ══ APPLY 20260910_0042 ══════════════════════════════════════════════════
SET p32.lane = 'staging';
\ir ../../../../supabase/migrations/20260910_0042_p33_owner_safe_round_correlation.sql
RESET p32.lane;

-- ══ AFTER — only the comment and the tag whose OWN round is published. ════
SELECT public.p42_suite('AFTER', 'A C-R1 PUBLISHED', '1');

-- ══ THE ACL AND THE SHAPE SURVIVED (F-66) ════════════════════════════════
\echo ''
\echo '── ACL AND RELATION IDENTITY AFTER CREATE OR REPLACE ────────────────────'
SELECT c.relname,
       c.relacl::text AS acl,
       (SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee = 0) AS public_entries,
       pg_get_userbyid(c.relowner) AS owner,
       coalesce(c.reloptions::text, '(none)') AS reloptions
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('judge_comments_owner_safe','judge_tag_assignments_owner_safe',
                     'judge_decisions_owner_safe')
 ORDER BY c.relname;

-- ══ THE REPORT ═══════════════════════════════════════════════════════════
\echo ''
\echo '── RESULTS ──────────────────────────────────────────────────────────────'
\pset border 2
SELECT seq, phase, subject, actor, expected, actual,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, label
  FROM public.p42_results ORDER BY seq;

\echo ''
\echo '── WHAT 0042 CHANGED (C-34: the rows that moved, and only those) ────────'
SELECT b.label, b.actual AS before, a.actual AS after,
       CASE WHEN b.actual IS DISTINCT FROM a.actual THEN 'CHANGED' ELSE 'unchanged' END AS verdict
  FROM public.p42_results b
  JOIN public.p42_results a ON a.label = b.label AND a.actor = b.actor AND a.phase = 'AFTER'
 WHERE b.phase = 'BEFORE' ORDER BY b.seq;

\echo ''
\echo '── SUMMARY ──────────────────────────────────────────────────────────────'
SELECT count(*) AS runs,
       count(*) FILTER (WHERE pass) AS pass,
       count(*) FILTER (WHERE NOT pass) AS fail,
       count(*) FILTER (WHERE phase = 'BEFORE') AS before_runs,
       count(*) FILTER (WHERE phase = 'AFTER') AS after_runs
  FROM public.p42_results;

DO $verdict$
DECLARE bad int; moved int;
BEGIN
  SELECT count(*) INTO bad FROM public.p42_results WHERE NOT pass;
  SELECT count(*) INTO moved FROM public.p42_results b
    JOIN public.p42_results a ON a.label = b.label AND a.actor = b.actor AND a.phase = 'AFTER'
   WHERE b.phase = 'BEFORE' AND b.actual IS DISTINCT FROM a.actual;
  IF bad > 0 THEN
    RAISE EXCEPTION 'P33 0042 TESTS FAILED — % assertion(s) did not hold', bad
      USING ERRCODE = 'raise_exception';
  END IF;
  IF moved <> 2 THEN
    RAISE EXCEPTION
      'P33 0042 TESTS INCONCLUSIVE — % result(s) changed between BEFORE and AFTER, '
      'expected exactly 2 (A''s comments and A''s tags). Either the file did nothing '
      'or it moved something it should not have', moved
      USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P33 0042 TESTS GREEN — every assertion held, and exactly the two leaking reads changed.';
END
$verdict$;
