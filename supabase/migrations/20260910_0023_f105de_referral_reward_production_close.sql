-- ═══════════════════════════════════════════════════════════════════════════
-- F-105d + F-105e — process_referral_reward STOPS TRUSTING THE CALLER'S CLAIM
-- ABOUT WHO IT IS **AND** THE ADMIN APPROVE BUTTON STARTS RESOLVING, IN ONE
-- TRANSACTION, SO THERE IS NO WINDOW BETWEEN THEM.
--
-- Owner authorised preparing this: asked whether to prepare the production-side
-- migration now, his word was "yes". APPLYING IT IS NOT THIS FILE'S AUTHOR'S
-- ACTION — it is the Owner's/Auditor's, through apply-migration.yml against the
-- production environment, exactly as 0019, 0020 and 0021 were.
--
-- ⚠ WHY ONE FILE INSTEAD OF PORTING 0019 THEN 0022. 0020's header already
-- makes this argument for the birthday pair and it holds here unchanged:
-- apply-migration.yml runs ONE FILE PER DISPATCH, each dispatch waits on its
-- own production environment approval, and psql is invoked WITHOUT
-- --single-transaction. Two files is therefore a real exposure window measured
-- in human-approval time, not seconds — the P31 run sat on that gate for a day
-- and a half.
--
-- Here the window would be worse than merely long, because the two fixes pull
-- in opposite directions:
--
--   * F-105e REQUIRES a DROP of the three-argument overload (a default cannot
--     be removed by CREATE OR REPLACE — 42P13, measured).
--   * A DROP resets the ACL: the built-in EXECUTE-to-PUBLIC default lands
--     (F-66) and ALTER DEFAULT PRIVILEGES re-grants anon, authenticated and
--     service_role.
--
-- So porting 0022 on its own, or second, would republish a VOLATILE
-- SECURITY DEFINER function that calls wallet_transaction() to **anon** and sit
-- that way until a human approved the next dispatch. In ONE transaction the
-- window is ZERO: Postgres DDL is transactional and no other session can
-- observe the intermediate state. psql is in autocommit here, so the explicit
-- BEGIN/COMMIT below is what makes that true.
--
-- ═══ WHAT THIS CLOSES ═══
--
-- F-105d — both overloads are SECURITY DEFINER, take `_referred_user_id` from
-- the caller, never compare it to auth.uid(), and call wallet_transaction(),
-- which issues the credit. Any signed-in member could credit any account by
-- naming it; the member being spent never appears in the request. Recorded by
-- the Auditor in PROMOTION_LEDGER 44.5 as "ARMED, NOT LOADED" — production had
-- zero referral rows, so it returns at its first statement today. That is a
-- fact about the DATA. The first referral row loads it.
--
-- F-105e — `_txn_amount numeric DEFAULT 0` makes the three-argument function an
-- equally good candidate for a TWO-argument call, so PostgREST cannot choose
-- between the overloads:
--
--     HTTP 300  PGRST203  Could not choose the best candidate function between:
--       public.process_referral_reward(_referred_user_id => uuid, _activity_type => text),
--       public.process_referral_reward(_referred_user_id => uuid, _activity_type => text, _txn_amount => numeric)
--
-- src/components/admin/AdminReferrals.tsx sends exactly two keys, so the admin
-- Approve button raises "Reward failed" and approves nothing. Removing the
-- default makes each arity resolve to exactly one function, with no client
-- change and therefore no deploy-ordering window.
--
-- ⚠ THAT 300 WAS MEASURED ON **STAGING**, NOT ON PRODUCTION. See the honesty
-- section at the foot of this header.
--
-- ═══ PRODUCTION HAS DRIFTED FROM STAGING, AND THAT CHANGED THIS FILE ═══
--
-- The obvious move — lift the finished bodies out of staging's 0019 and 0022 —
-- IS WRONG HERE, and checking rather than assuming is what caught it. The
-- production-lane definitions on main are NOT staging's:
--
--   main 20260228101821 (2-arg) and 20260228102118 (3-arg) have
--     * NO `FOR UPDATE` on the pending-referral SELECT  (staging: BUG-049)
--     * NO self-referral guard                          (staging: BUG-047)
--
-- Staging carries both, inherited through the 2026-09-11 bootstrap snapshot of
-- the OLD staging project. Nothing on main introduces them. Lifting staging's
-- bodies would therefore have smuggled two behaviour fixes into production
-- inside a security migration — a bulk modification, and exactly the kind of
-- change that must be its own unit with its own gate. **This file ports the
-- FIX, not the body.**
--
-- EVERY DEFINITION BELOW IS SLICED FROM THE FILES THAT PRODUCED THE RUNNING
-- OBJECTS — the guard block from staging's 20260910_0019_f105d verbatim (1051
-- bytes, md5 d9b6a218aaeaa4aeb37c3ff3d0caeaf1, identical in both of staging's
-- overloads), the bodies from main's own 20260228101821 and 20260228102118 —
-- not retyped and not reconstructed from the catalogue. The graft was proved
-- reversible before this file was written: removing the sliced guard and the
-- one added `_caller uuid;` declaration returns main's bodies BYTE-FOR-BYTE.
-- The only differences from main are the guard, that declaration, and the
-- removed DEFAULT.
--
-- ═══ THE PRECONDITION GATE, AND WHY IT IS NOT OPTIONAL ═══
--
-- This file was written WITHOUT PRODUCTION DATABASE ACCESS. Its bodies come
-- from main's migration source, which is a record of what was *dispatched*, not
-- proof of what is *running* — and this very unit found staging and production
-- disagreeing about the same function. If production has drifted again (a
-- hand-applied BUG-047/BUG-049 fix, say), then CREATE OR REPLACE with the body
-- below would SILENTLY REVERT it.
--
-- So the transaction opens by asserting the live bodies against the md5s of
-- main's source, BEFORE it changes anything, and refuses the whole file if they
-- disagree. Refusing to run is the correct outcome there — not a failure of
-- this file, but it doing the one thing a migration written blind must do.
--
-- ═══ WHAT IS AND IS NOT MEASURED — READ THIS BEFORE SIGNING IT OFF ═══
--
-- MEASURED, on staging (fpszggreishhuvdpkmdr), by the same fixes this file
-- ports: the 300 -> 401 transition over real HTTP through PostgREST; the
-- cross-member call refused and the self-call still admitted; the ACL surviving
-- the DROP+CREATE. Evidence: docs/evidence/d1/F-105e/OVERLOAD-RESOLUTION-HTTP.md
-- and apply-migration runs #61, #63, #64, #65, #66, #67.
--
-- NOT MEASURED, and not to be repeated as though it were:
--   * that production's live bodies match main's source. The precondition gate
--     is what turns this from an assumption into a check — it has never been
--     run against production.
--   * that production's PostgREST returns PGRST203 for the two-key call. It is
--     INFERRED from main carrying the same two overloads with the same DEFAULT
--     and no removing migration. No production request has been issued.
--   * that production's ACL on these two functions is what this file expects.
--     The end-state gate asserts the ACL it LEAVES, which is what matters for
--     safety, and deliberately does not assert what it found.
--
-- A run of this file against production is therefore also the first
-- measurement of it. The gates are written to make that safe, not to pretend
-- the measurement already happened.
--
-- ⚠ FILENAME. 0020 and 0021 are taken on main; staging holds 0019 and 0022.
-- 0023 is the next ordinal free on BOTH branches. (main and staging already
-- hold a different 20260910_0019 each — known and accepted, see
-- docs/evidence/d1/F-105e/OVERLOAD-RESOLUTION-HTTP.md.)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 0. PRECONDITION. Runs before any change; refuses rather than guesses. ═══
DO $pre$
DECLARE
  _n int; _oid2 oid; _oid3 oid; _md2 text; _md3 text;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward';
  IF _n <> 2 THEN
    RAISE EXCEPTION
      'P1 FAILED — expected exactly 2 process_referral_reward overloads on this database, found %. This file ports a fix for a KNOWN pair (2-arg admin override, 3-arg member path). A different shape means production is not what main''s source says, and nothing here should run against it.', _n;
  END IF;

  SELECT oid INTO _oid2 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text';
  SELECT oid INTO _oid3 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text, _txn_amount numeric';
  IF _oid2 IS NULL OR _oid3 IS NULL THEN
    RAISE EXCEPTION 'P1 FAILED — could not resolve both overloads by signature (2-arg %, 3-arg %).', _oid2, _oid3;
  END IF;

  SELECT md5(prosrc) INTO _md2 FROM pg_proc WHERE oid=_oid2;
  SELECT md5(prosrc) INTO _md3 FROM pg_proc WHERE oid=_oid3;

  -- P2 · THE BODIES MUST BE THE ONES THIS FILE WAS BUILT FROM.
  -- If they are not, the CREATE OR REPLACE below would overwrite whatever is
  -- actually there with main's source and silently revert it.
  IF _md2 <> 'a82168c949cbc3eef0dad32e17961730' THEN
    RAISE EXCEPTION
      'P2 FAILED — the live 2-arg body is md5 % (% bytes), not a82168c949cbc3eef0dad32e17961730 (1371 bytes) as main''s 20260228101821 defines it. Production has DRIFTED from its own migration source. Applying this file would overwrite the live body with main''s and silently revert whatever the difference is. RE-DERIVE this migration from the live prosrc before running it — do not weaken this check.',
      _md2, (SELECT length(prosrc) FROM pg_proc WHERE oid=_oid2);
  END IF;

  IF _md3 <> '12b13af9a3bfce42f6294d12d3e7d9cf' THEN
    RAISE EXCEPTION
      'P2 FAILED — the live 3-arg body is md5 % (% bytes), not 12b13af9a3bfce42f6294d12d3e7d9cf (2356 bytes) as main''s 20260228102118 defines it. Same reasoning as the 2-arg: RE-DERIVE rather than weaken.',
      _md3, (SELECT length(prosrc) FROM pg_proc WHERE oid=_oid3);
  END IF;

  -- P3 · THE DEFAULT MUST STILL BE THERE, or F-105e is already closed and this
  -- file is being run twice.
  SELECT pronargdefaults INTO _n FROM pg_proc WHERE oid=_oid3;
  IF _n <> 1 THEN
    RAISE EXCEPTION
      'P3 FAILED — the 3-arg overload has % parameter default(s); this file expects the unfixed state (exactly 1, on _txn_amount). If it is already 0, F-105e is closed here and this file has already run.', _n;
  END IF;

  RAISE NOTICE 'P1 ok — exactly two overloads, oids % (2-arg) and % (3-arg)', _oid2, _oid3;
  RAISE NOTICE 'P2 ok — both live bodies match main''s migration source';
  RAISE NOTICE 'P3 ok — the DEFAULT is present, i.e. this is the unfixed state';
END
$pre$;


-- ═══ 1. F-105d — the self-or-admin guard, on the TWO-argument overload ═══
-- CREATE OR REPLACE, not DROP+CREATE: it preserves the ACL, so this half does
-- not disturb the grants at all. (The 3-arg below has no such luxury.)
CREATE OR REPLACE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _referral record;
  _referrer_reward numeric;
  _referee_bonus numeric;
  _setting jsonb;
  _caller uuid;
BEGIN

  -- ═══ F-105d AUTHORISATION GATE. ADDED AHEAD OF EVERY OTHER STATEMENT. ═══
  -- Same shape as enroll_in_course's BUG-074 guard, deliberately: one rule,
  -- written the way this codebase already writes it.
  --
  -- IS DISTINCT FROM, NOT <>. With a NULL auth.uid() (anon, or no PostgREST
  -- request at all) `_referred_user_id <> auth.uid()` is NULL, the IF is not
  -- taken, and the guard passes the caller through — which is the exact
  -- opposite of what it is for. enroll_in_course's own guard is written with
  -- `<>` and has that hole; it is reported separately, not quietly edited here.
  _caller := (select auth.uid());

  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authorized: process_referral_reward requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF _referred_user_id IS DISTINCT FROM _caller
     AND NOT public.has_role(_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized: you can only process the referral reward for your own account'
      USING ERRCODE = '42501';
  END IF;
  -- Find pending referral for this user
  SELECT * INTO _referral
  FROM public.referrals
  WHERE referred_id = _referred_user_id AND status = 'pending'
  LIMIT 1;

  IF _referral IS NULL THEN RETURN; END IF;

  -- Get reward config from settings (defaults: referrer $1.00, referee $0.50)
  SELECT value INTO _setting FROM public.site_settings WHERE key = 'referral_reward';
  _referrer_reward := COALESCE((_setting->>'referrer_amount')::numeric, (_setting->>'amount')::numeric, 1.00);
  _referee_bonus := COALESCE((_setting->>'referee_bonus')::numeric, 0.50);

  -- Credit referrer wallet
  PERFORM wallet_transaction(
    _referral.referrer_id,
    'referral_earning',
    _referrer_reward,
    'Referral Reward – your invited friend completed their first ' || _activity_type,
    _referral.id,
    'referral'
  );

  -- Credit referee welcome bonus
  IF _referee_bonus > 0 THEN
    PERFORM wallet_transaction(
      _referred_user_id,
      'referral_bonus',
      _referee_bonus,
      'Welcome bonus – reward for joining via referral',
      _referral.id,
      'referral'
    );
  END IF;

  -- Update referral status
  UPDATE public.referrals
  SET status = 'rewarded', reward_amount = _referrer_reward, rewarded_at = now()
  WHERE id = _referral.id;
END;
$$;


-- ═══ 2. F-105d + F-105e — the guard AND the removed DEFAULT, three-argument ═══
-- The DROP is what F-105e requires and what makes the single transaction
-- load-bearing: between this DROP and the grants in section 3 the function
-- would be world-executable if these statements could be observed separately.
-- They cannot be; that is the whole design.
DROP FUNCTION public.process_referral_reward(uuid, text, numeric);

CREATE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text, _txn_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _referral record;
  _referrer_reward numeric;
  _referee_bonus numeric;
  _setting jsonb;
  _caller uuid;
  _enabled boolean;
  _min_amount numeric;
  _monthly_cap integer;
  _manual_approval boolean;
  _month_count integer;
BEGIN

  -- ═══ F-105d AUTHORISATION GATE. ADDED AHEAD OF EVERY OTHER STATEMENT. ═══
  -- Same shape as enroll_in_course's BUG-074 guard, deliberately: one rule,
  -- written the way this codebase already writes it.
  --
  -- IS DISTINCT FROM, NOT <>. With a NULL auth.uid() (anon, or no PostgREST
  -- request at all) `_referred_user_id <> auth.uid()` is NULL, the IF is not
  -- taken, and the guard passes the caller through — which is the exact
  -- opposite of what it is for. enroll_in_course's own guard is written with
  -- `<>` and has that hole; it is reported separately, not quietly edited here.
  _caller := (select auth.uid());

  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authorized: process_referral_reward requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF _referred_user_id IS DISTINCT FROM _caller
     AND NOT public.has_role(_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized: you can only process the referral reward for your own account'
      USING ERRCODE = '42501';
  END IF;
  -- Find pending referral for this user
  SELECT * INTO _referral
  FROM public.referrals
  WHERE referred_id = _referred_user_id AND status = 'pending'
  LIMIT 1;

  IF _referral IS NULL THEN RETURN; END IF;

  -- Get settings
  SELECT value INTO _setting FROM public.site_settings WHERE key = 'referral_reward';
  _enabled := COALESCE((_setting->>'enabled')::boolean, true);
  _referrer_reward := COALESCE((_setting->>'referrer_amount')::numeric, 1.00);
  _referee_bonus := COALESCE((_setting->>'referee_bonus')::numeric, 0.50);
  _min_amount := COALESCE((_setting->>'min_qualifying_amount')::numeric, 0);
  _monthly_cap := COALESCE((_setting->>'monthly_cap')::integer, 10);
  _manual_approval := COALESCE((_setting->>'manual_approval')::boolean, false);

  -- Check if program is enabled
  IF NOT _enabled THEN RETURN; END IF;

  -- Check minimum qualifying amount
  IF _txn_amount > 0 AND _txn_amount < _min_amount THEN RETURN; END IF;

  -- If manual approval required, leave as pending
  IF _manual_approval THEN RETURN; END IF;

  -- Check monthly cap for referrer
  SELECT COUNT(*) INTO _month_count
  FROM public.referrals
  WHERE referrer_id = _referral.referrer_id
    AND status = 'rewarded'
    AND rewarded_at >= date_trunc('month', now());

  IF _month_count >= _monthly_cap THEN
    -- Cap reached, mark as capped
    UPDATE public.referrals SET status = 'capped' WHERE id = _referral.id;
    RETURN;
  END IF;

  -- Credit referrer wallet
  PERFORM wallet_transaction(
    _referral.referrer_id,
    'referral_earning',
    _referrer_reward,
    'Referral Reward – your invited friend completed their first ' || _activity_type,
    _referral.id,
    'referral'
  );

  -- Credit referee welcome bonus
  IF _referee_bonus > 0 THEN
    PERFORM wallet_transaction(
      _referred_user_id,
      'referral_bonus',
      _referee_bonus,
      'Welcome bonus – reward for joining via referral',
      _referral.id,
      'referral'
    );
  END IF;

  -- Update referral status
  UPDATE public.referrals
  SET status = 'rewarded', reward_amount = _referrer_reward, rewarded_at = now()
  WHERE id = _referral.id;
END;
$$;


-- ═══ 3. THE ACL, DECLARED IN FULL FOR BOTH ═══
-- Not housekeeping, and not last by accident: it must follow every CREATE,
-- because a CREATE re-lands the grants a REVOKE took away (F-66, and 0021's
-- step 4 says the same thing about the same mechanism). Production's measured
-- default for a new function in schema public is {anon,authenticated,
-- service_role} plus the PUBLIC '=X/' entry.
--
-- Every role is named in the REVOKE, including the two then granted, so the end
-- state is WRITTEN HERE and does not depend on what either statement inherited.
-- PUBLIC first — the empty grantee is the finding (F-62/F-98).
REVOKE ALL ON FUNCTION public.process_referral_reward(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_referral_reward(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text, numeric)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.process_referral_reward(uuid, text) IS
  'Credits a referral reward. The ADMIN Approve button''s overload (AdminReferrals.tsx) — called with somebody else''s id by design, and applying none of the enabled/minimum/manual-approval/cap checks the 3-arg applies, which is what makes it an admin override. SELF-OR-ADMIN ONLY (F-105d): SECURITY DEFINER and calls wallet_transaction(), so before this guard any signed-in member could credit any account by naming it. Revoked from PUBLIC and anon; authenticated retains EXECUTE because the guard, not the grant, is the control.';

COMMENT ON FUNCTION public.process_referral_reward(uuid, text, numeric) IS
  'Credits a referral reward after a qualifying paid activity. Called by CompetitionSubmit.tsx for the caller''s own id, and by enroll_in_course() for the enrolling member. SELF-OR-ADMIN ONLY (F-105d). NO DEFAULT on _txn_amount (F-105e): the default made this an equally good candidate for a two-argument call, so PostgREST answered the admin Approve button with PGRST203 and the two-argument overload was unreachable. WARNING: _txn_amount is still supplied by the caller and gates the minimum-spend rule, so a member may clear that check for their OWN referral without having paid; closing that means moving this call server-side behind the submission RPC, and is deliberately NOT done here.';


-- ═══ 4. THE END STATE IS ASSERTED BEFORE COMMIT ═══
-- A wrong ACL or a lost guard rolls the whole thing back rather than shipping.
-- proacl is the instrument; has_function_privilege cannot tell a direct grant
-- from an inherited one and reported F-98's revoke as done when it was not
-- (C-89). Comments are stripped from prosrc before matching, because prosrc
-- CONTAINS them and the guard's own text explains the defect it prevents — an
-- unstripped LIKE matches the explanation and reports the defect (measured).
DO $gate$
DECLARE
  _oid2 oid; _oid3 oid; _n int; _acl2 text; _acl3 text; _def int;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward';
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G1 FAILED — % overloads after the recreate; expected exactly 2. The 2-arg is the admin override and the 3-arg the member path; they are not interchangeable.', _n;
  END IF;

  SELECT oid INTO _oid2 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text';
  SELECT oid INTO _oid3 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text, _txn_amount numeric';
  IF _oid2 IS NULL OR _oid3 IS NULL THEN
    RAISE EXCEPTION 'G1 FAILED — a signature changed; the client call sites no longer resolve the way this file assumes.';
  END IF;

  SELECT array_to_string(proacl,' | ') INTO _acl2 FROM pg_proc WHERE oid=_oid2;
  SELECT array_to_string(proacl,' | ') INTO _acl3 FROM pg_proc WHERE oid=_oid3;

  -- G2 · the F-105e unit: no parameter defaults on the 3-arg.
  SELECT pronargdefaults INTO _def FROM pg_proc WHERE oid=_oid3;
  IF _def <> 0 THEN
    RAISE EXCEPTION 'G2 FAILED — the 3-arg overload still carries % default(s); PostgREST will still answer the admin Approve button with PGRST203.', _def;
  END IF;

  -- G3 · a two-argument call resolves. Pass condition is NOT-42725, not
  -- no-error: the guard refuses an identity-less caller with 42501, and that
  -- refusal IS the function being reached, which is what is under test.
  BEGIN
    PERFORM public.process_referral_reward('00000000-0000-0000-0000-000000000000'::uuid, 'f105de gate'::text);
  EXCEPTION
    WHEN ambiguous_function THEN
      RAISE EXCEPTION 'G3 FAILED — a two-argument call is still ambiguous (42725), the SQL-side twin of the PGRST203 the admin button receives.';
    WHEN insufficient_privilege THEN NULL;   -- expected: the F-105d guard
  END;

  -- G4 · PUBLIC holds nothing. Checked before the per-role reads, because if
  -- PUBLIC holds EXECUTE every reading below is true by inheritance (F-62).
  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee=0;
  IF _n > 0 THEN
    RAISE EXCEPTION 'G4 FAILED — PUBLIC holds EXECUTE (% entries). The DROP re-landed the built-in default and section 3 did not hold (F-66). acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  -- G5 · anon holds nothing. VOLATILE + wallet_transaction + anon is the
  -- combination the platform rule forbids outright.
  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee='anon'::regrole;
  IF _n > 0 THEN
    RAISE EXCEPTION 'G5 FAILED — anon holds EXECUTE (% entries) on a VOLATILE function that calls wallet_transaction(). acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  -- G6 · NOT an over-revoke. Both call sites are member-invoked.
  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee='authenticated'::regrole;
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G6 FAILED — authenticated holds EXECUTE on % of 2 overloads. AdminReferrals.tsx (2-arg) and CompetitionSubmit.tsx (3-arg) are both member calls; the guard in the body is the control here, not the grant. acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN (_oid2,_oid3) AND a.grantee='service_role'::regrole;
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G6 FAILED — service_role holds EXECUTE on % of 2 overloads. acl2 = % | acl3 = %', _n, _acl2, _acl3;
  END IF;

  -- G7 · the guard is actually in both bodies, and NULL-safe in both.
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (_oid2,_oid3)
     AND regexp_replace(p.prosrc,'--[^\n]*','','g') LIKE '%IS DISTINCT FROM _caller%'
     AND regexp_replace(p.prosrc,'--[^\n]*','','g') LIKE '%has_role(_caller%';
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G7 FAILED — only % of 2 overloads carry the self-or-admin guard. F-105d is open on the other one.', _n;
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (_oid2,_oid3)
     AND regexp_replace(p.prosrc,'--[^\n]*','','g') LIKE '%_referred_user_id <> %';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'G7 FAILED — % overload(s) compare _referred_user_id with a bare <>. Against a NULL auth.uid() that yields NULL, the IF is never taken, and the guard admits precisely the caller it exists to refuse.', _n;
  END IF;

  -- G8 · still definer with a pinned search_path, on both.
  SELECT count(*) INTO _n FROM pg_proc
   WHERE oid IN (_oid2,_oid3) AND prosecdef
     AND array_to_string(proconfig,',') LIKE '%search_path=public%';
  IF _n <> 2 THEN
    RAISE EXCEPTION 'G8 FAILED — only % of 2 overloads are SECURITY DEFINER with a pinned search_path. Without the pinned search_path a definer function is a privilege-escalation shape.', _n;
  END IF;

  RAISE NOTICE 'G1 ok — both overloads present, oids % (2-arg) and % (3-arg)', _oid2, _oid3;
  RAISE NOTICE 'G2 ok — the 3-arg overload has no parameter defaults (F-105e)';
  RAISE NOTICE 'G3 ok — a TWO-argument call resolves to exactly one function (not 42725)';
  RAISE NOTICE 'G4 ok — PUBLIC holds nothing, so the readings below mean something';
  RAISE NOTICE 'G5 ok — anon CANNOT execute either overload';
  RAISE NOTICE 'G6 ok — authenticated and service_role retain EXECUTE on both';
  RAISE NOTICE 'G7 ok — the self-or-admin guard is present and NULL-safe on both (F-105d)';
  RAISE NOTICE 'G8 ok — SECURITY DEFINER with pinned search_path on both';
  RAISE NOTICE 'final acl 2-arg = %', _acl2;
  RAISE NOTICE 'final acl 3-arg = %', _acl3;
  RAISE NOTICE '--- F-105d + F-105e CLOSED IN ONE TRANSACTION ---';
END
$gate$;

COMMIT;
