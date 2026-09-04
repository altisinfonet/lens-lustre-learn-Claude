-- ═══════════════════════════════════════════════════════════════════════════
-- CROSS-MEMBER PROBE — get_top_contributors_v3. READS ONLY. CHANGES NOTHING.
--
-- The gate for OWNER-RULING-2026-09-03-02 requires "a cross-member test proves
-- the function exposes nothing a member should not see". This is that test.
--
-- The `PROBE_` prefix follows the convention already established by
-- PROBE_credential_connectivity_readonly.sql: a name that tells any future
-- reader, at a glance, that the file is not part of the migration sequence. It
-- is dispatched through apply-migration.yml like any other reviewed file, and
-- it is safe to run against either lane, any number of times.
--
-- ⚠ RUN IT AFTER the v3 migration and BEFORE the Home card is switched to v3.
-- A green run is a precondition of the behaviour step, not a report on it.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THIS TEST IS SHAPED THE WAY IT IS
--
-- get_top_contributors_v3 is SECURITY DEFINER and anon-executable. DEFINER
-- bypasses RLS entirely, so the WHERE clause is the only control and there is
-- no second line of defence. The measured precedent on this platform is that
-- the same read RPC with one predicate omitted returned private rows to anon.
--
-- v3 takes no arguments, so there is no parameter an attacker can point at a
-- member of their choosing. That removes the usual enumeration route and leaves
-- exactly three ways it could leak, which are the three things asserted below:
--
--   A1  it returns MORE than the three public rows            (the row cap)
--   A2  it returns something ABOUT a caller                   (personalisation)
--   A3  the helper behind it becomes callable directly        (full enumeration)
--
-- plus two shape assertions, A4 and A5, that stop a later edit widening it.
--
-- ⚠ A TEST THAT COULD NOT HAVE FAILED IS NOT EVIDENCE (C-34). Every assertion
-- here was shown FAILING against a deliberately loosened copy of v3 before this
-- file was accepted. A1 is the one that matters: with `WHERE rk.pos <= 3`
-- removed, measured on production 2026-09-03 08:46:15Z, the correct function
-- returned 3 rows and the loosened one returned 44 — 41 members' recent and
-- lifetime scores handed to anonymous callers by one dropped line. A1 caught it.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It does not call the function over HTTP as
-- a real anonymous browser would, so it does not test PostgREST's own exposure
-- rules; it tests the database object. It does not prove the Home card renders
-- correctly — that is D2's half and a browser question, and `curl` is not a
-- browser (F-53). Say what was proved, and no more.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  -- Two real members, taken from the top three so nothing here reveals anyone
  -- the public Home page does not already name. Deliberately NOT hard-coded to
  -- specific uuids: they are read from the function's own output, so this probe
  -- keeps working as the leaderboard changes.
  member_a       uuid;
  member_b       uuid;
  outsider       uuid;
  row_count      integer;
  result_sig     text;
  fp_anon        text;
  fp_member_a    text;
  fp_member_b    text;
  helper_anon    boolean;
  helper_auth    boolean;
  v3_anon        boolean;
  v3_auth        boolean;
  v3_volatility  "char";
  v3_secdef      boolean;
  v2_present     boolean;
  v2_anon        boolean;
  leaked         integer;
BEGIN
  RAISE NOTICE '--- cross-member probe: get_top_contributors_v3 @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  ---------------------------------------------------------------------------
  -- A1 · THE ROW CAP. The single predicate that stands between a public card
  -- and a full leaderboard dump. This is the assertion that caught the
  -- loosened copy.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO row_count FROM public.get_top_contributors_v3();

  IF row_count > 3 THEN
    RAISE EXCEPTION
      'A1 FAILED — get_top_contributors_v3 returned % rows. The card shows three. Anything above three means the `WHERE rk.pos <= 3` predicate is gone and every eligible member''s recent and lifetime score is being handed to anonymous callers.',
      row_count;
  END IF;
  RAISE NOTICE 'A1 row cap ......................... PASS (% row(s), cap 3)', row_count;

  -- A1's own denominator, so the pass is interpretable rather than merely green:
  -- how many members WOULD be exposed if the cap were removed.
  SELECT count(*) INTO leaked
    FROM public.contributor_points_since(((now() AT TIME ZONE 'UTC')::date - 29)) r
   WHERE r.score > 0;
  RAISE NOTICE '     (% member(s) currently rank above zero; % would be exposed without the cap)',
    leaked, GREATEST(leaked - row_count, 0);

  IF row_count = 0 THEN
    RAISE EXCEPTION
      'A1 FAILED — get_top_contributors_v3 returned no rows at all, but % member(s) have a non-zero 30-day score. The function is broken, not safe.',
      leaked;
  END IF;

  ---------------------------------------------------------------------------
  -- A2 · NO PERSONALISATION. The cross-member half. If the output differs by
  -- caller, then one member is learning something about another that the public
  -- card does not already show. Run as member A, as member B, and as anon; the
  -- three fingerprints must be identical.
  ---------------------------------------------------------------------------
  SELECT t.user_id INTO member_a FROM public.get_top_contributors_v3() t WHERE t.rank_position = 1;
  SELECT t.user_id INTO member_b FROM public.get_top_contributors_v3() t
   WHERE t.rank_position = LEAST(2, row_count);

  -- A member who is NOT on the card, so "an outsider sees the same thing" is
  -- tested too, not just "the people on it see it".
  SELECT pr.id INTO outsider
    FROM public.profiles pr
   WHERE pr.id NOT IN (SELECT t.user_id FROM public.get_top_contributors_v3() t)
   ORDER BY pr.id
   LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  SELECT string_agg(t.user_id::text || ':' || t.rank_position || ':' || t.contributor_score || ':' || t.recent_score,
                    ',' ORDER BY t.rank_position)
    INTO fp_anon FROM public.get_top_contributors_v3() t;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', member_a, 'role','authenticated')::text, true);
  SELECT string_agg(t.user_id::text || ':' || t.rank_position || ':' || t.contributor_score || ':' || t.recent_score,
                    ',' ORDER BY t.rank_position)
    INTO fp_member_a FROM public.get_top_contributors_v3() t;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', COALESCE(outsider, member_b), 'role','authenticated')::text, true);
  SELECT string_agg(t.user_id::text || ':' || t.rank_position || ':' || t.contributor_score || ':' || t.recent_score,
                    ',' ORDER BY t.rank_position)
    INTO fp_member_b FROM public.get_top_contributors_v3() t;

  PERFORM set_config('request.jwt.claims', '', true);

  IF fp_member_a IS DISTINCT FROM fp_member_b THEN
    RAISE EXCEPTION
      'A2 FAILED — two different members received different results. The function is personalised, so one member is learning something about another. A: % / B: %',
      fp_member_a, fp_member_b;
  END IF;
  IF fp_member_a IS DISTINCT FROM fp_anon THEN
    RAISE EXCEPTION
      'A2 FAILED — a signed-in member received a different result from an anonymous caller. Whatever the difference is, it is not on the public card. member: % / anon: %',
      fp_member_a, fp_anon;
  END IF;
  RAISE NOTICE 'A2 caller independence ............. PASS (member A = member B = anon, identical)';

  ---------------------------------------------------------------------------
  -- A3 · THE HELPER STAYS SHUT. contributor_points_since returns EVERY
  -- eligible member's score for an arbitrary date. It is the enumeration
  -- endpoint this whole design exists to keep closed; v3 reaches it only
  -- because v3 is DEFINER. If this ever reads true, the leaderboard has become
  -- a directory of the entire membership.
  ---------------------------------------------------------------------------
  SELECT has_function_privilege('anon',          p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
    INTO helper_anon, helper_auth
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'contributor_points_since';

  IF helper_anon OR helper_auth THEN
    RAISE EXCEPTION
      'A3 FAILED — contributor_points_since is directly executable (anon=%, authenticated=%). It returns every eligible member''s score for any date the caller chooses. Revoke it.',
      helper_anon, helper_auth;
  END IF;
  RAISE NOTICE 'A3 helper not directly callable .... PASS (anon=false, authenticated=false)';

  ---------------------------------------------------------------------------
  -- A4 · THE SHAPE IS EXACTLY THE FROZEN SIGNATURE. A later edit that adds a
  -- count, a minute figure or a formula internal fails here — that half of the
  -- Owner's 2026-08-11 instruction is NOT superseded.
  --
  -- Asserted against pg_get_function_result() as a whole string rather than by
  -- counting names. Counting pg_proc.proargnames looked equivalent and is not:
  -- for a function WITH input arguments that array holds the input names too
  -- (measured 2026-09-03 08:49:33Z — get_contributor_scores reports
  -- {_user_ids,user_id,contributor_score}). v3 takes no arguments today, so the
  -- count would have been right today and silently wrong the day someone adds a
  -- parameter. The full signature string pins the column names AND their types,
  -- which is what "frozen shape" actually means.
  ---------------------------------------------------------------------------
  SELECT pg_get_function_result(p.oid) INTO result_sig
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_top_contributors_v3';

  IF result_sig IS DISTINCT FROM
     'TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)' THEN
    RAISE EXCEPTION
      'A4 FAILED — the return signature is not the one the interface froze.%  expected: TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)%  actual:   %',
      chr(10), chr(10), result_sig;
  END IF;
  RAISE NOTICE 'A4 frozen signature ................ PASS (%)', result_sig;

  ---------------------------------------------------------------------------
  -- A5 · POSTURE. STABLE not VOLATILE (a volatile anon function is the
  -- amplification class); DEFINER as designed; grants matched to v2's roles and
  -- not exceeded; and v2 still present and still working, because v2 is the
  -- rollback.
  ---------------------------------------------------------------------------
  SELECT p.provolatile, p.prosecdef,
         has_function_privilege('anon',          p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
    INTO v3_volatility, v3_secdef, v3_anon, v3_auth
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_top_contributors_v3';

  IF v3_volatility <> 's' THEN
    RAISE EXCEPTION
      'A5 FAILED — get_top_contributors_v3 is not STABLE (provolatile=%). An anon-executable VOLATILE function is an amplification target.',
      v3_volatility;
  END IF;
  IF NOT v3_secdef THEN
    RAISE EXCEPTION 'A5 FAILED — get_top_contributors_v3 is not SECURITY DEFINER, so it cannot reach the helper and the card will be empty.';
  END IF;
  IF NOT (v3_anon AND v3_auth) THEN
    RAISE EXCEPTION 'A5 FAILED — v3 is not executable by anon (%) and authenticated (%). The Home page is public.', v3_anon, v3_auth;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='get_top_contributors_v2')
    INTO v2_present;
  IF NOT v2_present THEN
    RAISE EXCEPTION 'A5 FAILED — get_top_contributors_v2 is gone. v2 is the rollback and must stay until the Auditor authorises its removal.';
  END IF;

  SELECT has_function_privilege('anon', p.oid, 'EXECUTE') INTO v2_anon
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='get_top_contributors_v2';
  IF NOT v2_anon THEN
    RAISE EXCEPTION 'A5 FAILED — get_top_contributors_v2 exists but anon can no longer execute it, so the rollback path is broken.';
  END IF;
  RAISE NOTICE 'A5 posture ......................... PASS (STABLE, DEFINER, anon+authenticated, v2 intact and anon-executable)';

  RAISE NOTICE '--- ALL FIVE ASSERTIONS PASSED. Nothing was written. ---';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
