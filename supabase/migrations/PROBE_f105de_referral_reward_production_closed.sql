-- F-105d + F-105e GATE PROBE (production lane) — the self-or-admin guard holds
-- on both overloads AND each arity resolves to exactly one function. WRITES NOTHING.
--
-- Run with: psql "$DB_URL" -f supabase/migrations/PROBE_f105de_referral_reward_production_closed.sql
-- Exits non-zero on the first failed assertion.
--
-- ⚠ RUN THIS BEFORE 0024 AS WELL AS AFTER. Before, G2/G3/G6 must FAIL — that is
-- the C-34 fail-first evidence, and a probe that has never been seen red is not
-- evidence that anything was closed. After 0024 every assertion must pass.
--
-- ⚠ WHAT PRODUCTION HAS AND HAS NOT TOLD US. Run #69 refused 0023 at its own
-- precondition gate and in doing so produced the FIRST real production
-- readings: exactly two overloads exist, and the 2-arg body is md5
-- 7999749b88688973dc95680d68ae5e86 (1416 bytes) — the bootstrap-snapshot body,
-- not the one main's 20260228101821 defines. Everything else about production
-- is still inferred: the 3-arg body, the DEFAULT, the ACL, and whether its
-- PostgREST returns PGRST203 at all.
--
-- ⚠ RUN PROBE_process_referral_reward_source_dump_readonly.sql FIRST. It is
-- read-only, reads no member data, and prints both live definitions with their
-- md5, byte length, default count and ACL — turning those inferences into
-- readings before anything is changed. The BEFORE run of THIS probe is then not
-- a formality either: it is the behavioural measurement, and if it disagrees
-- with the inference, 0024 must be re-derived rather than forced.
--
-- ⚠ WHY THE WHOLE FILE IS BEGIN … ROLLBACK. This probe CALLS the function under
-- test, and that function issues wallet credits. Two independent reasons
-- nothing can be written: the transaction is discarded, and every identity used
-- is a uuid that exists in no table, so the first statement past the guard finds
-- no pending referral and returns.
--
-- ⚠ proacl IS THE INSTRUMENT for the grant assertions, never
--   has_function_privilege — it cannot tell a direct grant from one inherited
--   through PUBLIC, and told both the developer and the Auditor that F-98's
--   revoke had worked when it had not (C-89).
--
-- ⚠ WHAT THIS PROBE CANNOT SEE. F-105e's real defect is PostgREST's
-- (HTTP 300 / PGRST203). This file runs inside the database and tests the
-- SQL-side twin (42725 ambiguous_function) — same cause, same fix, same line.
-- The HTTP reading has to be taken over HTTP. On staging that was done with
-- pg_net; see docs/evidence/d1/F-105e/OVERLOAD-RESOLUTION-HTTP.md. G3 is an
-- honest proxy, not a substitute.

BEGIN;

DO $probe$
DECLARE
  _oid2  oid;
  _oid3  oid;
  _n     int;
  _def   int;
  _acl2  text;
  _acl3  text;
  _alice uuid := gen_random_uuid();
  _bob   uuid := gen_random_uuid();
  _state text;
  _raised boolean;
BEGIN
  RAISE NOTICE '--- F-105d+e gate probe (production lane) @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- G1 · BOTH OVERLOADS EXIST AND ARE DISTINCT.
  -- They are not interchangeable: the 2-arg is the admin override and applies
  -- NONE of the enabled/minimum/manual-approval/cap checks the 3-arg applies.
  SELECT oid INTO _oid2 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text';
  SELECT oid INTO _oid3 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text, _txn_amount numeric';
  IF _oid2 IS NULL OR _oid3 IS NULL THEN
    RAISE EXCEPTION
      'G1 FAILED — both overloads must exist (2-arg %, 3-arg %). Losing either silently changes what an approval means.', _oid2, _oid3;
  END IF;

  SELECT array_to_string(proacl,' | ') INTO _acl2 FROM pg_proc WHERE oid=_oid2;
  SELECT array_to_string(proacl,' | ') INTO _acl3 FROM pg_proc WHERE oid=_oid3;

  -- G2 · F-105e: no parameter defaults on the 3-arg overload.
  SELECT pronargdefaults INTO _def FROM pg_proc WHERE oid=_oid3;
  IF _def <> 0 THEN
    RAISE EXCEPTION
      'G2 FAILED — the 3-arg overload carries % parameter default(s). A DEFAULT on _txn_amount makes it an equally good candidate for a TWO-argument call, so PostgREST answers the admin Approve button with HTTP 300 / PGRST203 and the 2-arg overload is unreachable. If this is the FIRST run, this is the expected C-34 fail-first reading and 0024 has not been applied.', _def;
  END IF;

  -- G3 · BEHAVIOURAL. A two-argument call resolves to exactly one function.
  -- ⚠ PASS CONDITION IS "NOT 42725", NOT "NO ERROR". The F-105d guard refuses
  -- this call with 42501 because the probe holds no identity — that refusal is
  -- the function being REACHED, which is what is under test. Asserting
  -- "no error" would make this gate red on a correct database.
  BEGIN
    PERFORM public.process_referral_reward(_bob, 'f105de probe'::text);
    _state := '00000';
  EXCEPTION WHEN OTHERS THEN
    _state := SQLSTATE;
  END;
  IF _state = '42725' THEN
    RAISE EXCEPTION
      'G3 FAILED — a two-argument call is still ambiguous (42725 ambiguous_function), the SQL-side twin of the PGRST203 the admin Approve button receives over HTTP.';
  END IF;
  IF _state NOT IN ('00000','42501') THEN
    RAISE EXCEPTION
      'G3 FAILED — a two-argument call raised SQLSTATE %, neither success nor the expected 42501 from the F-105d guard. It resolved, so the ambiguity is closed, but something else is wrong and this gate will not wave it through.', _state;
  END IF;

  -- G4 · The THREE-argument member path still resolves. CompetitionSubmit.tsx
  -- and enroll_in_course() both use it, and enroll_in_course swallows the
  -- exception with EXCEPTION WHEN OTHERS THEN NULL — so a break there is silent.
  BEGIN
    PERFORM public.process_referral_reward(_bob, 'f105de probe'::text, 100::numeric);
    _state := '00000';
  EXCEPTION WHEN OTHERS THEN
    _state := SQLSTATE;
  END;
  IF _state NOT IN ('00000','42501') THEN
    RAISE EXCEPTION 'G4 FAILED — the THREE-argument call now raises SQLSTATE %.', _state;
  END IF;

  -- ═══ G5–G7 are F-105d: the guard itself, gone through rather than read. ═══

  -- G5 · CROSS-MEMBER CALL IS REFUSED. Alice, signed in, names Bob.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', _alice::text, true);

  _raised := false;
  BEGIN
    PERFORM public.process_referral_reward(_bob, 'f105de probe'::text, 100::numeric);
  EXCEPTION WHEN insufficient_privilege THEN
    _raised := true;
  END;
  IF NOT _raised THEN
    RAISE EXCEPTION
      'G5 FAILED — a signed-in caller (%) successfully called process_referral_reward naming a DIFFERENT member (%). This is F-105d: SECURITY DEFINER, calls wallet_transaction(), takes the beneficiary as an argument. If this is the FIRST run, this is the expected fail-first reading.', _alice, _bob;
  END IF;

  -- G6 · THE SELF PATH STILL WORKS. Alice names Alice. CompetitionSubmit.tsx
  -- passes user.id, so this is the live member path and it must NOT raise.
  BEGIN
    PERFORM public.process_referral_reward(_alice, 'f105de probe'::text, 100::numeric);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'G6 FAILED — a member calling for THEIR OWN id (%) was refused. The guard over-reached: CompetitionSubmit.tsx is DOWN, and enroll_in_course() would fail SILENTLY because it swallows this exception.', _alice;
  END;

  -- G7 · NO IDENTITY AT ALL IS REFUSED. The NULL-handling trap: written with
  -- `<>` instead of IS DISTINCT FROM, the comparison against a NULL auth.uid()
  -- yields NULL, the IF is not taken, and an unauthenticated caller walks
  -- straight through the guard.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  _raised := false;
  BEGIN
    PERFORM public.process_referral_reward(_bob, 'f105de probe'::text, 100::numeric);
  EXCEPTION WHEN insufficient_privilege THEN
    _raised := true;
  END;
  IF NOT _raised THEN
    RAISE EXCEPTION
      'G7 FAILED — a caller with NO auth.uid() was allowed through the guard. This is the `<>` vs IS DISTINCT FROM defect.';
  END IF;

  -- G8 · THE ACL. PUBLIC first: if PUBLIC holds EXECUTE every per-role reading
  -- below is true by inheritance and would report the wrong cause (F-62).
  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee=0;
  IF _n > 0 THEN
    RAISE EXCEPTION 'G8 FAILED — PUBLIC holds EXECUTE (% entries). 0024 drops and recreates the 3-arg, so the built-in default may have re-landed (F-66). acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee='anon'::regrole;
  IF _n > 0 THEN
    RAISE EXCEPTION 'G8 FAILED — anon holds EXECUTE (% entries) on a VOLATILE function that calls wallet_transaction(). acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee='authenticated'::regrole;
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G8 FAILED — authenticated holds EXECUTE on % of 2 overloads. Both call sites are member-invoked; an over-revoke is as much a defect as an under-revoke. acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee='service_role'::regrole;
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G8 FAILED — service_role holds EXECUTE on % of 2 overloads. acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  -- G9 · SECURITY DEFINER with a pinned search_path, on both. 0024 recreates
  -- the 3-arg, so this is not a formality.
  SELECT count(*) INTO _n FROM pg_proc
   WHERE oid IN (_oid2,_oid3) AND prosecdef
     AND array_to_string(proconfig,',') LIKE '%search_path=public%';
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G9 FAILED — only % of 2 overloads are SECURITY DEFINER with a pinned search_path. Without it a definer function is a privilege-escalation shape.', _n;
  END IF;

  RAISE NOTICE 'G1 ok — both overloads present, oids % (2-arg) and % (3-arg)', _oid2, _oid3;
  RAISE NOTICE 'G2 ok — the 3-arg overload has no parameter defaults (F-105e)';
  RAISE NOTICE 'G3 ok — a TWO-argument call resolves to exactly one function (not 42725)';
  RAISE NOTICE 'G4 ok — the THREE-argument member path still resolves';
  RAISE NOTICE 'G5 ok — a signed-in member CANNOT name another member (F-105d, the unit)';
  RAISE NOTICE 'G6 ok — a member CAN still process their own referral (CompetitionSubmit path intact)';
  RAISE NOTICE 'G7 ok — a caller with no auth.uid() is refused (the IS DISTINCT FROM case)';
  RAISE NOTICE 'G8 ok — no PUBLIC, no anon; authenticated + service_role retained on both';
  RAISE NOTICE 'G9 ok — SECURITY DEFINER with pinned search_path on both';
  RAISE NOTICE 'acl 2-arg = %', _acl2;
  RAISE NOTICE 'acl 3-arg = %', _acl3;
  RAISE NOTICE '--- F-105d+e PROBE PASSED ---';
END
$probe$;

-- Nothing this probe did is kept. The call under test moves money.
ROLLBACK;
