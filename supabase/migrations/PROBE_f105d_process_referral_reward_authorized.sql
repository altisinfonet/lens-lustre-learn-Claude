-- F-105d GATE PROBE — process_referral_reward is self-or-admin only. WRITES NOTHING.
--
-- Run with: psql "$DB_URL" -f supabase/migrations/PROBE_f105d_process_referral_reward_authorized.sql
-- Exits non-zero on the first failed assertion.
--
-- ⚠ RUN THIS BEFORE 0019 AS WELL AS AFTER. Before, G6 must FAIL — that is the
-- C-34 fail-first evidence, and a probe that has never been seen red is not
-- evidence that anything was closed. After 0019 every assertion must pass.
--
-- ⚠ WHY THE WHOLE FILE IS BEGIN … ROLLBACK, AND WHY IT IS NOT BELT-AND-BRACES
--
-- This probe does something PROBE_f105a does not: it CALLS the function. That
-- is the point — F-105d is not a grant that can be read off the catalogue, it
-- is a PREDICATE INSIDE A BODY, and the only honest way to know a predicate
-- holds is to go through it. But the function it calls issues wallet credits.
-- If the guard is missing (which is precisely the state this probe exists to
-- detect) the call does not raise — it RUNS. So:
--
--   1. the whole file runs inside one transaction that ends in ROLLBACK, and
--   2. every identity below is a freshly generated uuid that exists in no
--      table, so the very first statement past the guard (`SELECT … FROM
--      referrals WHERE referred_id = <that uuid> AND status = 'pending'`)
--      finds nothing and the function returns before any wallet_transaction().
--
-- Two independent reasons nothing can be written, because one of them is the
-- thing under test and must not also be the thing relied upon.
--
-- ⚠ proacl IS THE INSTRUMENT for the grant assertions, never
--   has_function_privilege — it cannot distinguish a direct grant from one
--   inherited through PUBLIC, and told both the developer and the Auditor that
--   F-98's revoke had worked when it had not (C-89).

BEGIN;

DO $probe$
DECLARE
  _oid2      oid;
  _oid3      oid;
  _n         int;
  _acl2      text;
  _acl3      text;
  _public_n  int;
  _anon_n    int;
  _auth_n    int;
  _svc_n     int;
  _alice     uuid := gen_random_uuid();
  _bob       uuid := gen_random_uuid();
  _raised    boolean;
BEGIN
  RAISE NOTICE '--- F-105d gate probe: process_referral_reward @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- G1 · EXACTLY TWO OVERLOADS, both oids captured.
  -- The gate is per-function. A green reading on one oid says nothing about
  -- the other, and this finding is specifically that BOTH were open.
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'process_referral_reward';
  IF _n <> 2 THEN
    RAISE EXCEPTION
      'G1 FAILED — expected exactly 2 process_referral_reward overloads, found %. The 2-arg is the admin Approve button (AdminReferrals.tsx) and the 3-arg is the member path (CompetitionSubmit.tsx, enroll_in_course). If one is missing, a call site is DOWN; if there is a third, it was never reviewed and this gate does not cover it.', _n;
  END IF;

  SELECT p.oid INTO _oid2 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'process_referral_reward'
     AND pg_get_function_identity_arguments(p.oid) = '_referred_user_id uuid, _activity_type text';
  SELECT p.oid INTO _oid3 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'process_referral_reward'
     AND pg_get_function_identity_arguments(p.oid) = '_referred_user_id uuid, _activity_type text, _txn_amount numeric';

  IF _oid2 IS NULL OR _oid3 IS NULL THEN
    RAISE EXCEPTION
      'G1 FAILED — could not resolve both overloads by signature (2-arg oid %, 3-arg oid %). A signature changed, which means the client call sites no longer resolve the way this gate assumes.', _oid2, _oid3;
  END IF;

  SELECT array_to_string(proacl,' | ') INTO _acl2 FROM pg_proc WHERE oid = _oid2;
  SELECT array_to_string(proacl,' | ') INTO _acl3 FROM pg_proc WHERE oid = _oid3;

  -- G2 · NO PUBLIC ENTRY ON EITHER — CHECKED FIRST, AND THE ORDER IS THE POINT.
  -- A function has one privilege, EXECUTE. If PUBLIC holds it, every per-role
  -- reading below is true by inheritance and would report the wrong cause.
  SELECT count(*) INTO _public_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2, _oid3) AND a.grantee = 0;
  IF _public_n > 0 THEN
    RAISE EXCEPTION
      'G2 FAILED — PUBLIC holds EXECUTE (% entries across the two overloads). Every reading below is meaningless (F-62). Most likely the function was DROPped and recreated, re-acquiring the built-in EXECUTE-to-PUBLIC default (F-66) — 0019 uses CREATE OR REPLACE precisely so this cannot happen. acl2 = % | acl3 = %',
      _public_n, _acl2, _acl3;
  END IF;

  -- G3 · anon closed on both. VOLATILE + wallet_transaction + anon is the
  -- combination the platform rule forbids outright.
  SELECT count(*) INTO _anon_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2, _oid3) AND a.grantee = 'anon'::regrole;
  IF _anon_n > 0 THEN
    RAISE EXCEPTION
      'G3 FAILED — anon holds EXECUTE (% entries). This function is VOLATILE and calls wallet_transaction(); a caller holding only the publishable key must never reach it. acl2 = % | acl3 = %',
      _anon_n, _acl2, _acl3;
  END IF;

  -- G4 · NOT AN OVER-REVOKE. authenticated MUST keep EXECUTE on BOTH.
  -- This is the assertion that would have caught a blanket revoke, which is
  -- the obvious-looking fix and would have taken two live features down.
  SELECT count(*) INTO _auth_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2, _oid3) AND a.grantee = 'authenticated'::regrole;
  IF _auth_n <> 2 THEN
    RAISE EXCEPTION
      'G4 FAILED — authenticated holds EXECUTE on % of 2 overloads. Both client call sites are member-invoked: AdminReferrals.tsx:124 (2-arg, Approve button) and CompetitionSubmit.tsx:328 (3-arg). An over-revoke is as much a defect as an under-revoke — the guard in the body is the control here, not the grant. acl2 = % | acl3 = %',
      _auth_n, _acl2, _acl3;
  END IF;

  -- G5 · service_role retains EXECUTE on both.
  SELECT count(*) INTO _svc_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2, _oid3) AND a.grantee = 'service_role'::regrole;
  IF _svc_n <> 2 THEN
    RAISE EXCEPTION
      'G5 FAILED — service_role holds EXECUTE on % of 2 overloads. acl2 = % | acl3 = %',
      _svc_n, _acl2, _acl3;
  END IF;

  -- ═══ THE UNIT ITSELF. Everything above is the catalogue; these go through
  -- the predicate. ═══

  -- G6 · CROSS-MEMBER CALL IS REFUSED. Alice, signed in, names Bob.
  -- This is the finding, stated as an executable question: before 0019 this
  -- call returned successfully and would have credited Bob's referrer.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', _alice::text, true);

  -- ⚠ EVERY BEHAVIOURAL CALL BELOW USES THE THREE-ARGUMENT FORM, AND THAT IS
  -- NOT A PREFERENCE. A two-argument call cannot be resolved in SQL at all:
  --
  --     process_referral_reward(uuid, text)
  --       -> 42725 function public.process_referral_reward(uuid, text) is not unique
  --
  -- because the 3-arg overload's `_txn_amount numeric DEFAULT 0` makes it an
  -- equally good candidate for a 2-argument call. Named notation does not help
  -- (measured: same 42725). The FIRST version of this probe called the 2-arg
  -- form, went red, and looked exactly like the fail-first reading it was
  -- supposed to produce — while actually testing nothing. A probe that fails
  -- for the wrong reason is worse than no probe, so the resolution behaviour is
  -- pinned as G9 below rather than left as a trap for the next reader.
  _raised := false;
  BEGIN
    PERFORM public.process_referral_reward(_bob, 'f105d probe'::text, 100::numeric);
  EXCEPTION WHEN insufficient_privilege THEN
    _raised := true;
  END;
  IF NOT _raised THEN
    RAISE EXCEPTION
      'G6 FAILED — a signed-in caller (%) successfully called process_referral_reward naming a DIFFERENT member (%). This is F-105d itself: SECURITY DEFINER, calls wallet_transaction(), and takes the beneficiary as an argument. If this is the FIRST run of this probe, this failure is the expected C-34 fail-first reading and 0019 has not been applied yet.',
      _alice, _bob;
  END IF;

  -- G7 · THE SELF PATH STILL WORKS. Alice names Alice.
  -- CompetitionSubmit.tsx:328 passes `user.id`, so this is the live member
  -- path. It must NOT raise. (It returns silently: Alice has no referrals row.)
  BEGIN
    PERFORM public.process_referral_reward(_alice, 'f105d probe'::text, 100::numeric);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'G7 FAILED — a member calling for THEIR OWN id (%) was refused. The guard has over-reached and CompetitionSubmit.tsx:328 is DOWN — worse, enroll_in_course() swallows this exception with EXCEPTION WHEN OTHERS THEN NULL, so course-purchase referral rewards would fail silently.',
      _alice;
  END;

  -- G8 · NO IDENTITY AT ALL IS REFUSED.
  -- The NULL-handling trap: written with `<>` instead of IS DISTINCT FROM, the
  -- comparison against a NULL auth.uid() yields NULL, the IF is not taken, and
  -- an unauthenticated caller walks straight through the guard.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  _raised := false;
  BEGIN
    PERFORM public.process_referral_reward(_bob, 'f105d probe'::text, 100::numeric);
  EXCEPTION WHEN insufficient_privilege THEN
    _raised := true;
  END;
  IF NOT _raised THEN
    RAISE EXCEPTION
      'G8 FAILED — a caller with NO auth.uid() at all was allowed through the guard. This is the `<>` vs IS DISTINCT FROM defect: `_referred_user_id <> NULL` is NULL, not TRUE, so the IF never fires and the guard admits precisely the caller it was written to refuse.';
  END IF;

  -- G9 · THE 2-ARG OVERLOAD CARRIES THE SAME GUARD — READ FROM prosrc.
  -- It cannot be reached from SQL (see G6's note), so this one assertion is a
  -- source reading rather than a call, and is labelled as such instead of being
  -- dressed up as behavioural evidence. PostgREST resolves overloads by
  -- matching the JSON keys to parameter names rather than by SQL's rules, which
  -- is how AdminReferrals.tsx reaches it; whether it succeeds in doing so on
  -- this database has NOT been measured here and is an open question for D2.
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.oid IN (_oid2, _oid3)
     AND p.prosrc LIKE '%IS DISTINCT FROM _caller%'
     AND p.prosrc LIKE '%has_role(_caller%';
  IF _n <> 2 THEN
    RAISE EXCEPTION
      'G9 FAILED — only % of the 2 overloads carry the self-or-admin guard in their body. Closing one overload and leaving the other is exactly how this finding was produced. 2-arg oid %, 3-arg oid %.',
      _n, _oid2, _oid3;
  END IF;

  -- G10 · THE GUARD IS NULL-SAFE IN SOURCE TOO.
  -- G8 proves the behaviour, but only for whichever overload SQL resolves. A
  -- bare `<>` reintroduced into either body is the defect regardless.
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.oid IN (_oid2, _oid3)
     AND p.prosrc LIKE '%_referred_user_id <> %';
  IF _n <> 0 THEN
    RAISE EXCEPTION
      'G10 FAILED — % overload(s) compare _referred_user_id with a bare <>. Against a NULL auth.uid() that yields NULL, the IF is never taken, and the guard admits precisely the caller it exists to refuse.', _n;
  END IF;

  RAISE NOTICE 'G1 ok — exactly two overloads, oids % (2-arg) and % (3-arg)', _oid2, _oid3;
  RAISE NOTICE 'G2 ok — PUBLIC entries = 0, so the per-role readings mean something';
  RAISE NOTICE 'G3 ok — anon CANNOT execute either overload';
  RAISE NOTICE 'G4 ok — authenticated RETAINS EXECUTE on both (both call sites live)';
  RAISE NOTICE 'G5 ok — service_role retains EXECUTE on both';
  RAISE NOTICE 'G6 ok — a signed-in member CANNOT name another member (the unit), both overloads';
  RAISE NOTICE 'G7 ok — a member CAN still process their own referral (CompetitionSubmit path intact)';
  RAISE NOTICE 'G8 ok — a caller with no auth.uid() is refused (the IS DISTINCT FROM case)';
  RAISE NOTICE 'G9 ok — BOTH overloads carry the guard in prosrc (2-arg is unreachable from SQL)';
  RAISE NOTICE 'G10 ok — neither overload uses a bare <> against _referred_user_id';
  RAISE NOTICE 'acl 2-arg = %', _acl2;
  RAISE NOTICE 'acl 3-arg = %', _acl3;
  RAISE NOTICE '--- F-105d PROBE PASSED ---';
END
$probe$;

-- Nothing this probe did is kept. See the header: the call under test is the
-- one that moves money, so the transaction is discarded rather than committed.
ROLLBACK;
