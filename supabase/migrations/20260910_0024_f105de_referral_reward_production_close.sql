-- ═══════════════════════════════════════════════════════════════════════════
-- F-105d + F-105e ON PRODUCTION — RE-DERIVED FROM WHAT IS ACTUALLY RUNNING.
-- SUPERSEDES 20260910_0023, WHICH WAS BUILT ON A STALE ASSUMPTION AND WAS
-- CORRECTLY REFUSED BY ITS OWN PRECONDITION GATE.
--
-- Owner authorised preparing the production-side migration: "yes". APPLYING IT
-- IS NOT THIS FILE'S AUTHOR'S ACTION — it is the Owner's/Auditor's, through
-- apply-migration.yml against the production environment, as 0019, 0020 and
-- 0021 were.
--
-- ═══ WHAT RUN #69 PROVED, AND WHY THIS FILE EXISTS ═══
--
-- 0023 was dispatched against production and refused itself at P2:
--
--   live 2-arg body md5 7999749b88688973dc95680d68ae5e86 (1416 bytes),
--   expected a82168c949cbc3eef0dad32e17961730 (1371 bytes) per main's
--   20260228101821.
--
-- Nothing was applied. The transaction rolled back. **That is the gate working,
-- not the gate failing** — and the remedy 0023's own header prescribes is the
-- one taken here: re-derive from the live prosrc, never weaken the check.
--
-- ═══ THE CORRECTION, AND IT INVERTS WHAT 0023 BELIEVED ═══
--
-- 7999749b88688973dc95680d68ae5e86 / 1416 bytes is not an unknown value. It is
-- BYTE-FOR-BYTE the 2-arg body in staging's 20260911101721 bootstrap snapshot —
-- the snapshot taken of the OLD staging project. Verified by recomputing it
-- from that file, not by recognising it.
--
-- So production is running the SAME body staging inherited, which means:
--
--   ⚠ PRODUCTION ALREADY HAS BUG-049 (the `FOR UPDATE` lock on the pending
--     referral) AND BUG-047 (the self-referral guard).
--
-- 0023's header asserted the opposite — that production lacked both, and that
-- porting staging's bodies would smuggle two behaviour fixes into production
-- inside a security migration. **That reasoning was sound and its premise was
-- wrong.** main's 20260228101821 and 20260228102118 do not describe production;
-- they are STALE. The drift is in the repository, not in the database. Whatever
-- applied BUG-047/BUG-049 to both lanes left no migration on main.
--
-- That the stale source was the only production-lane record available is
-- exactly why 0023 carried a precondition gate, and exactly why the gate was
-- not optional. This is the fourth time in this project a claim repeated from a
-- document has had to be corrected against the running thing (C-38, C-42, C-44,
-- C-45); it is the first time the correction cost nothing, because the check
-- was written before the claim was acted on.
--
-- ═══ WHAT THIS FILE INSTALLS ═══
--
-- Because production's pre-state is staging's pre-state, the finished bodies
-- are staging's finished bodies. EVERY DEFINITION BELOW IS SLICED FROM THE
-- MIGRATIONS THAT PRODUCED THE RUNNING OBJECTS ON STAGING — the 2-arg from
-- 20260910_0019_f105d (md5 f7242f2cc0989c74ff3731abfc2500ba, 2483 bytes), the
-- 3-arg from 20260910_0022_f105e (md5 df71a90afca03692c1873846c72771cc, 3291
-- bytes) — not retyped, and not reconstructed from the catalogue. Both were
-- re-verified against staging's LIVE pg_proc before this file was written.
--
-- There is no grafting in this file and no body surgery. 0023 needed both
-- because it was fitting a guard onto a different body; this one does not,
-- because the two lanes agree. The whole class of error that truncated 0023's
-- first guard cannot occur here.
--
-- Applied, production and staging hold byte-identical definitions of both
-- overloads. That is a property worth having and it is stated so it can be
-- checked rather than assumed.
--
-- ═══ WHY ONE FILE, ONE TRANSACTION — unchanged from 0023, and still true ═══
--
-- apply-migration.yml runs ONE FILE PER DISPATCH, each dispatch waits on its
-- own production environment approval, and psql is invoked WITHOUT
-- --single-transaction. 0020's header makes this argument for the birthday
-- pair; here it is sharper, because the two fixes pull in opposite directions:
--
--   * F-105e REQUIRES a DROP of the three-argument overload (a default cannot
--     be removed by CREATE OR REPLACE — 42P13, measured).
--   * A DROP resets the ACL: the built-in EXECUTE-to-PUBLIC default lands
--     (F-66) and ALTER DEFAULT PRIVILEGES re-grants anon, authenticated and
--     service_role.
--
-- Ported separately, the F-105e half would republish a VOLATILE
-- SECURITY DEFINER function that calls wallet_transaction() to **anon** and
-- leave it that way until a human approved the next dispatch. In ONE
-- transaction the window is ZERO. psql is in autocommit, so the explicit
-- BEGIN/COMMIT below is what makes that true.
--
-- ═══ WHAT IS MEASURED ON PRODUCTION, AND WHAT STILL IS NOT ═══
--
-- ⚠ UPDATED 2026-09-12 AFTER RUN #70. The source-dump probe has now been run
-- against production, so most of what this section used to list as inferred is
-- measured. Every expectation this file gates on was CONFIRMED:
--
--   MEASURED, run #69's refusal:
--     * EXACTLY TWO overloads, both resolvable by the identity signatures used
--       here (oids 20345 and 20346).
--     * 2-arg body md5 7999749b88688973dc95680d68ae5e86, 1416 bytes.  -> P2a ✓
--
--   MEASURED, run #70's source dump:
--     * 3-arg body md5 5a69d3fa10a09745b9bfd1a5a7d48690, 2224 bytes.  -> P2b ✓
--       (this was the INFERENCE, and it was correct)
--     * 3-arg parameter defaults = 1, i.e. the unfixed state.          -> P3  ✓
--     * both bodies carry BUG-049's FOR UPDATE and BUG-047's self-referral
--       guard, confirming production is on the bootstrap-snapshot bodies.
--     * the ACL, on BOTH overloads:
--
--           postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres
--
--       ⚠ NO PUBLIC ENTRY AND NO anon ENTRY. Production is NOT on Supabase's
--       default ACL — it had already closed both by some route that left no
--       migration on main, the same way it acquired BUG-047/049. That is the
--       ONE reading that disagreed with an assumption, and it did not change
--       this file: the end state declared in section 3 is exactly what
--       production already has, so the ACL statements are a no-op here and the
--       end-state gate still proves it. **It did change the ROLLBACK**, which
--       had been written to re-grant PUBLIC and anon and would have left
--       production more open than it found it. Corrected; see that file.
--
-- STILL NOT MEASURED:
--   * whether production's PostgREST returns PGRST203 for a two-key call. It
--     remains an inference from the two overloads and the DEFAULT — both of
--     which are now confirmed present, so the inference is better supported
--     than it was, but no production HTTP request has ever been issued.
--
-- ⚠ IF THIS FILE IS RE-DISPATCHED AFTER A DELAY, RUN
-- PROBE_process_referral_reward_source_dump_readonly.sql AGAIN FIRST. It is
-- read-only and touches no member data. The readings above are from
-- 2026-09-12; a database is not a document, and the whole reason this file has
-- a precondition gate is that the last thing anyone assumed about production
-- turned out to be false.
--
-- ⚠ FILENAME. 0023 is taken by the superseded attempt (PR #232, to be closed
-- unmerged); 0020 and 0021 are taken on main; staging holds 0019 and 0022. 0024
-- is the next ordinal free on every branch. Should both 0023 and 0024 somehow
-- land, they are defended in depth: 0023's P2 would refuse against the state
-- this file leaves.
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
      'P1 FAILED — expected exactly 2 process_referral_reward overloads, found %. This file closes a KNOWN pair (2-arg admin override, 3-arg member path). Run PROBE_process_referral_reward_source_dump_readonly.sql and re-derive from what it prints.', _n;
  END IF;

  SELECT oid INTO _oid2 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text';
  SELECT oid INTO _oid3 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='process_referral_reward'
     AND pg_get_function_identity_arguments(oid)='_referred_user_id uuid, _activity_type text, _txn_amount numeric';
  IF _oid2 IS NULL OR _oid3 IS NULL THEN
    RAISE EXCEPTION 'P1 FAILED — could not resolve both overloads by signature (2-arg %, 3-arg %). Run the source-dump probe.', _oid2, _oid3;
  END IF;

  SELECT md5(prosrc) INTO _md2 FROM pg_proc WHERE oid=_oid2;
  SELECT md5(prosrc) INTO _md3 FROM pg_proc WHERE oid=_oid3;

  -- P2a · THE 2-ARG BODY. This value was MEASURED on production by run #69.
  IF _md2 <> '7999749b88688973dc95680d68ae5e86' THEN
    RAISE EXCEPTION
      'P2a FAILED — live 2-arg body is md5 % (% bytes), not 7999749b88688973dc95680d68ae5e86 (1416 bytes). That expected value was MEASURED on production by run #69, so a mismatch means production has changed again since. Run PROBE_process_referral_reward_source_dump_readonly.sql and re-derive. DO NOT weaken this check.',
      _md2, (SELECT length(prosrc) FROM pg_proc WHERE oid=_oid2);
  END IF;

  -- P2b · THE 3-ARG BODY. MEASURED by run #70's source dump (it was an
  -- inference when this file was written, and run #70 confirmed it). A failure
  -- here now means production has changed since 2026-09-12.
  IF _md3 <> '5a69d3fa10a09745b9bfd1a5a7d48690' THEN
    RAISE EXCEPTION
      'P2b FAILED — live 3-arg body is md5 % (% bytes), not 5a69d3fa10a09745b9bfd1a5a7d48690 (2224 bytes). This value was MEASURED on production by run #70 on 2026-09-12, so a mismatch means production has changed since. Run PROBE_process_referral_reward_source_dump_readonly.sql and re-derive from what it prints. DO NOT weaken this check.',
      _md3, (SELECT length(prosrc) FROM pg_proc WHERE oid=_oid3);
  END IF;

  -- P3 · THE DEFAULT MUST STILL BE THERE. Also never reached by run #69.
  SELECT pronargdefaults INTO _n FROM pg_proc WHERE oid=_oid3;
  IF _n <> 1 THEN
    RAISE EXCEPTION
      'P3 FAILED — the 3-arg overload has % parameter default(s); this file expects the unfixed state (exactly 1, on _txn_amount). If it is already 0, F-105e is closed on this database and this file has already run.', _n;
  END IF;

  -- P4 · RECORD THE PRE-ACL. Deliberately a NOTICE and not an assertion:
  -- correcting the ACL is part of this file's job, so refusing because the ACL
  -- is wrong would refuse exactly the case it exists to fix. Recording it puts
  -- the before-state in the same audit-trailed log as the after-state, which is
  -- what a rollback author needs and what this unit got wrong once already.
  RAISE NOTICE 'P4 · pre-ACL 2-arg = %', (SELECT coalesce(array_to_string(proacl,' | '),'(null = Supabase default)') FROM pg_proc WHERE oid=_oid2);
  RAISE NOTICE 'P4 · pre-ACL 3-arg = %', (SELECT coalesce(array_to_string(proacl,' | '),'(null = Supabase default)') FROM pg_proc WHERE oid=_oid3);

  RAISE NOTICE 'P1 ok — exactly two overloads, oids % (2-arg) and % (3-arg)', _oid2, _oid3;
  RAISE NOTICE 'P2a ok — 2-arg body matches the value MEASURED on production by run #69';
  RAISE NOTICE 'P2b ok — 3-arg body matches the value MEASURED on production by run #70';
  RAISE NOTICE 'P3 ok — the DEFAULT is present, i.e. this is the unfixed state';
END
$pre$;


-- ═══ 1. F-105d — the self-or-admin guard, TWO-argument overload ═══
-- Sliced from staging's 20260910_0019_f105d. CREATE OR REPLACE, not
-- DROP+CREATE: it preserves the ACL, so this half disturbs no grants.
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
  -- BUG-049: lock the pending referral so a concurrent call blocks and then finds
  -- it already 'rewarded' (no double-credit).
  SELECT * INTO _referral
  FROM public.referrals
  WHERE referred_id = _referred_user_id AND status = 'pending'
  LIMIT 1
  FOR UPDATE;

  IF _referral IS NULL THEN RETURN; END IF;
  -- BUG-047: never reward a self-referral.
  IF _referral.referrer_id = _referred_user_id THEN RETURN; END IF;

  SELECT value INTO _setting FROM public.site_settings WHERE key = 'referral_reward';
  _referrer_reward := COALESCE((_setting->>'referrer_amount')::numeric, (_setting->>'amount')::numeric, 1.00);
  _referee_bonus := COALESCE((_setting->>'referee_bonus')::numeric, 0.50);

  PERFORM wallet_transaction(
    _referral.referrer_id,
    'referral_earning',
    _referrer_reward,
    'Referral Reward – your invited friend completed their first ' || _activity_type,
    _referral.id,
    'referral'
  );

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

  UPDATE public.referrals
  SET status = 'rewarded', reward_amount = _referrer_reward, rewarded_at = now()
  WHERE id = _referral.id;
END;
$$;


-- ═══ 2. F-105d + F-105e — guard AND removed DEFAULT, THREE-argument ═══
-- Sliced from staging's 20260910_0022_f105e, which is 0019's body with the
-- DEFAULT removed. The DROP is what F-105e requires and what makes the single
-- transaction load-bearing: between it and the grants in section 3 the function
-- would be world-executable if these statements could be observed separately.
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
  -- BUG-049: lock the pending referral (serialize concurrent qualifying activity).
  SELECT * INTO _referral
  FROM public.referrals
  WHERE referred_id = _referred_user_id AND status = 'pending'
  LIMIT 1
  FOR UPDATE;

  IF _referral IS NULL THEN RETURN; END IF;
  -- BUG-047: never reward a self-referral.
  IF _referral.referrer_id = _referred_user_id THEN RETURN; END IF;

  SELECT value INTO _setting FROM public.site_settings WHERE key = 'referral_reward';
  _enabled := COALESCE((_setting->>'enabled')::boolean, true);
  _referrer_reward := COALESCE((_setting->>'referrer_amount')::numeric, 1.00);
  _referee_bonus := COALESCE((_setting->>'referee_bonus')::numeric, 0.50);
  _min_amount := COALESCE((_setting->>'min_qualifying_amount')::numeric, 0);
  _monthly_cap := COALESCE((_setting->>'monthly_cap')::integer, 10);
  _manual_approval := COALESCE((_setting->>'manual_approval')::boolean, false);

  IF NOT _enabled THEN RETURN; END IF;

  IF _txn_amount > 0 AND _txn_amount < _min_amount THEN RETURN; END IF;

  IF _manual_approval THEN RETURN; END IF;

  SELECT COUNT(*) INTO _month_count
  FROM public.referrals
  WHERE referrer_id = _referral.referrer_id
    AND status = 'rewarded'
    AND rewarded_at >= date_trunc('month', now());

  IF _month_count >= _monthly_cap THEN
    UPDATE public.referrals SET status = 'capped' WHERE id = _referral.id;
    RETURN;
  END IF;

  PERFORM wallet_transaction(
    _referral.referrer_id,
    'referral_earning',
    _referrer_reward,
    'Referral Reward – your invited friend completed their first ' || _activity_type,
    _referral.id,
    'referral'
  );

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
