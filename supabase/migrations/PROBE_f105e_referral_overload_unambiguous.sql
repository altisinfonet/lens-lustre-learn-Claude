-- F-105e GATE PROBE — each arity of process_referral_reward resolves to exactly
-- one function, and the F-105d guard and ACL survived the recreate. WRITES NOTHING.
--
-- Run with: psql "$DB_URL" -f supabase/migrations/PROBE_f105e_referral_overload_unambiguous.sql
-- Exits non-zero on the first failed assertion.
--
-- ⚠ RUN THIS BEFORE 0022 AS WELL AS AFTER. Before, G2 and G3 must FAIL — that
-- is the C-34 fail-first evidence, and a probe that has never been seen red is
-- not evidence that anything was closed. After 0022 every assertion must pass.
--
-- ⚠ WHY THE WHOLE FILE IS BEGIN … ROLLBACK. Like PROBE_f105d, this probe CALLS
-- the function under test, and that function issues wallet credits. Two
-- independent reasons nothing can be written: the transaction is discarded, and
-- every identity used is a freshly generated uuid that exists in no table, so
-- the first statement past the guard finds no pending referral and returns.
--
-- ⚠ WHAT THIS PROBE CANNOT SEE, STATED SO IT IS NOT MISTAKEN FOR COVERAGE.
-- The defect F-105e fixes is PostgREST's, not Postgres's: HTTP 300 / PGRST203.
-- This file runs inside the database and therefore tests the SQL-side twin of
-- that defect (42725 ambiguous_function), which has the same cause — the
-- DEFAULT — and is fixed by the same line. The HTTP reading itself is evidence
-- that has to be taken over HTTP; it is recorded in the 0022 header and was
-- re-taken through pg_net after the apply. G3 below is the in-database proxy,
-- and an honest one, but it is a proxy.

BEGIN;

DO $probe$
DECLARE
  _oid2     oid;
  _oid3     oid;
  _n        int;
  _defaults int;
  _acl3     text;
  _rid      uuid := gen_random_uuid();
  _state    text;
BEGIN
  RAISE NOTICE '--- F-105e gate probe: overload resolution @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- G1 · BOTH OVERLOADS STILL EXIST.
  -- 0022 removes a DEFAULT. It must not remove, merge or rename a function —
  -- the two are NOT interchangeable (the 2-arg is the admin override and skips
  -- the enabled / minimum / manual-approval / cap checks the 3-arg applies).
  SELECT p.oid INTO _oid2 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'process_referral_reward'
     AND pg_get_function_identity_arguments(p.oid) = '_referred_user_id uuid, _activity_type text';
  SELECT p.oid INTO _oid3 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'process_referral_reward'
     AND pg_get_function_identity_arguments(p.oid) = '_referred_user_id uuid, _activity_type text, _txn_amount numeric';

  IF _oid2 IS NULL OR _oid3 IS NULL THEN
    RAISE EXCEPTION
      'G1 FAILED — both overloads must exist (2-arg oid %, 3-arg oid %). The 2-arg is the admin Approve button and applies NO enabled/minimum/manual-approval/cap checks; the 3-arg is the member path and applies all four. Losing either silently changes what an approval means.',
      _oid2, _oid3;
  END IF;

  -- G2 · THE UNIT. The 3-arg overload has NO parameter defaults.
  SELECT pronargdefaults INTO _defaults FROM pg_proc WHERE oid = _oid3;
  IF _defaults <> 0 THEN
    RAISE EXCEPTION
      'G2 FAILED — the 3-arg overload carries % parameter default(s). A DEFAULT on _txn_amount makes this function an equally good candidate for a TWO-argument call, so PostgREST cannot choose between the overloads and answers the admin Approve button with HTTP 300 / PGRST203. If this is the FIRST run of this probe, this failure is the expected C-34 fail-first reading and 0022 has not been applied yet.',
      _defaults;
  END IF;

  -- G3 · BEHAVIOURAL. A two-argument call resolves to exactly one function.
  -- ⚠ THE PASS CONDITION IS "NOT 42725", NOT "NO ERROR". F-105d's guard refuses
  -- this call with 42501 because the probe holds no identity — that refusal is
  -- the function being REACHED, which is precisely what is under test here.
  -- Asserting "no error" would make this gate red on a correct database and
  -- would have to be loosened later by someone who no longer remembers why.
  BEGIN
    PERFORM public.process_referral_reward(_rid, 'f105e probe'::text);
    _state := '00000';
  EXCEPTION WHEN OTHERS THEN
    _state := SQLSTATE;
  END;

  IF _state = '42725' THEN
    RAISE EXCEPTION
      'G3 FAILED — a two-argument call is still ambiguous (42725 ambiguous_function). This is the SQL-side twin of the PGRST203 the admin Approve button receives over HTTP; same cause, same fix. 0022 has not taken effect.';
  END IF;
  IF _state NOT IN ('00000', '42501') THEN
    RAISE EXCEPTION
      'G3 FAILED — a two-argument call raised SQLSTATE %, which is neither success nor the expected 42501 from the F-105d self-or-admin guard. The call resolved, so the overload ambiguity is closed, but something else about this function is now wrong and this gate will not wave it through.',
      _state;
  END IF;

  -- G4 · THE THREE-ARGUMENT CALL DID NOT BREAK IN THE PROCESS.
  -- Removing a default is exactly the change that could make the member path
  -- stop resolving, and CompetitionSubmit.tsx and enroll_in_course() both use it.
  BEGIN
    PERFORM public.process_referral_reward(_rid, 'f105e probe'::text, 100::numeric);
    _state := '00000';
  EXCEPTION WHEN OTHERS THEN
    _state := SQLSTATE;
  END;
  IF _state NOT IN ('00000', '42501') THEN
    RAISE EXCEPTION
      'G4 FAILED — the THREE-argument call now raises SQLSTATE %. CompetitionSubmit.tsx:328 and enroll_in_course() both call this arity, and enroll_in_course swallows the exception with EXCEPTION WHEN OTHERS THEN NULL — so this would fail silently there.',
      _state;
  END IF;

  -- G5 · THE ACL SURVIVED THE DROP+CREATE. This is the F-66 gate and the
  -- single most likely way 0022 could do harm: a recreate takes Supabase's
  -- ALTER DEFAULT PRIVILEGES grants and hands EXECUTE back to PUBLIC and anon
  -- with no line in any file saying so.
  SELECT array_to_string(proacl, ' | ') INTO _acl3 FROM pg_proc WHERE oid = _oid3;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = _oid3 AND a.grantee = 0;
  IF _n > 0 THEN
    RAISE EXCEPTION
      'G5 FAILED — PUBLIC holds EXECUTE on the recreated 3-arg overload. F-66: the DROP reset the ACL and the REVOKE in 0022 did not hold. This function is VOLATILE and calls wallet_transaction(). acl = %', _acl3;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = _oid3 AND a.grantee = 'anon'::regrole;
  IF _n > 0 THEN
    RAISE EXCEPTION
      'G5 FAILED — anon holds EXECUTE on the recreated 3-arg overload. acl = %', _acl3;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = _oid3 AND a.grantee = 'authenticated'::regrole;
  IF _n <> 1 THEN
    RAISE EXCEPTION
      'G5 FAILED — authenticated LOST EXECUTE on the recreated 3-arg overload. CompetitionSubmit.tsx:328 is a member call and is now DOWN. An over-revoke is as much a defect as an under-revoke. acl = %', _acl3;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = _oid3 AND a.grantee = 'service_role'::regrole;
  IF _n <> 1 THEN
    RAISE EXCEPTION
      'G5 FAILED — service_role LOST EXECUTE on the recreated 3-arg overload. acl = %', _acl3;
  END IF;

  -- G6 · 0022 WAS NOT A PLACE TO REDEFINE THE FUNCTION.
  -- It drops and recreates, so unlike a revoke-only file it CAN silently carry
  -- a different body. F-105d's guard must still be in there, and the recreate
  -- must still be SECURITY DEFINER with a pinned search_path. Comments are
  -- stripped before matching: prosrc contains them, and the guard's own
  -- explanation mentions the defect it prevents (this cost a red gate once).
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.oid IN (_oid2, _oid3)
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%IS DISTINCT FROM _caller%'
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%has_role(_caller%';
  IF _n <> 2 THEN
    RAISE EXCEPTION
      'G6 FAILED — only % of the 2 overloads still carry F-105d''s self-or-admin guard. 0022 recreates the 3-arg overload; if the guard is gone, this file silently reopened F-105d while claiming to fix an overload-resolution bug.', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.oid = _oid3 AND p.prosecdef
     AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%';
  IF _n <> 1 THEN
    RAISE EXCEPTION
      'G6 FAILED — the recreated 3-arg overload is not SECURITY DEFINER with a pinned search_path. Without the pinned search_path a definer function is a privilege-escalation shape. proconfig = %',
      (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = _oid3);
  END IF;

  RAISE NOTICE 'G1 ok — both overloads present, oids % (2-arg) and % (3-arg)', _oid2, _oid3;
  RAISE NOTICE 'G2 ok — the 3-arg overload has no parameter defaults (the unit)';
  RAISE NOTICE 'G3 ok — a TWO-argument call resolves to exactly one function (not 42725)';
  RAISE NOTICE 'G4 ok — the THREE-argument member path still resolves';
  RAISE NOTICE 'G5 ok — ACL survived the DROP+CREATE: no PUBLIC, no anon, authenticated + service_role kept';
  RAISE NOTICE 'G6 ok — F-105d''s guard intact on both, definer + pinned search_path intact';
  RAISE NOTICE 'acl 3-arg = %', _acl3;
  RAISE NOTICE '--- F-105e PROBE PASSED ---';
END
$probe$;

-- Nothing this probe did is kept. The call under test moves money.
ROLLBACK;
