-- ═══════════════════════════════════════════════════════════════════════════
-- F-105e — THE ADMIN APPROVE BUTTON HAS NEVER WORKED. IT IS NOT A GRANT, A
-- ROLE, OR A GUARD: PostgREST CANNOT TELL THE TWO OVERLOADS APART.
--
-- MEASURED, OVER REAL HTTP, THROUGH THE PROJECT'S OWN PostgREST, 2026-09-12.
-- (This sandbox's egress policy denies supabase.co, so the request was issued
-- from inside the database with pg_net — the same endpoint the browser hits.)
--
--   POST /rest/v1/rpc/process_referral_reward
--   { "_referred_user_id": "<uuid>", "_activity_type": "manual approval" }
--     -> HTTP 300
--        PGRST203 Could not choose the best candidate function between:
--          public.process_referral_reward(_referred_user_id => uuid, _activity_type => text),
--          public.process_referral_reward(_referred_user_id => uuid, _activity_type => text, _txn_amount => numeric)
--
--   POST same endpoint, THREE keys (the CompetitionSubmit shape) -> HTTP 401
--        42501 permission denied for function process_referral_reward
--
-- THE SECOND READING IS WHY THE FIRST IS CONCLUSIVE, and it is the only reason
-- this file does not need an admin JWT to justify itself. The three-key call
-- was refused for PERMISSION; the two-key call was refused at ROUTING, with a
-- 300, before any permission check ran. Routing strictly precedes
-- authorisation, and a JWT changes only authorisation — so an admin receives
-- the same 300. src/components/admin/AdminReferrals.tsx:124 sends exactly two
-- keys. The button raises "Reward failed" and no referral has ever been
-- approved through it.
--
-- WHY THE TWO CANNOT BE TOLD APART
--
-- `_txn_amount numeric DEFAULT 0` makes the three-argument function an equally
-- good candidate for a two-argument call. SQL says the same thing in its own
-- words: 42725 function ... is not unique, positional AND named.
--
-- ═══ THE FIX IS THE SMALLEST ONE, AND THE OTHER TWO WERE REJECTED FOR CAUSE ═══
--
-- Removing the DEFAULT makes each arity resolve to exactly one function. Both
-- call sites keep the function they call today and the semantics they have
-- today. NO CLIENT CHANGE, which is the property that matters most here:
--
-- ✗ REJECTED — point AdminReferrals at the three-argument overload.
--   The three-argument body contains `IF _manual_approval THEN RETURN; END IF;`
--   and the two-argument body contains NONE of the enabled / minimum /
--   manual-approval / monthly-cap checks (verified: zero matches). Manual
--   approval is the ONLY setting under which an admin needs to approve
--   anything, so this would turn a loud PGRST203 into a SILENT NO-OP in
--   precisely the case the button exists for. A silent wrong answer is worse
--   than a visible failure.
--
-- ✗ REJECTED — rename or drop the two-argument overload.
--   Sound as an end state, unsafe as a step. Drop it and a two-key request
--   falls through to the three-argument function VIA THE DEFAULT — so between
--   applying this SQL and deploying the client there is a window in which the
--   button silently no-ops, the same defect as above wearing a different hat.
--   Any rename-based fix must remove the DEFAULT first regardless; this file
--   is that prerequisite, not a detour around it.
--
-- ⚠ WHY THIS FILE DROPS AND RECREATES, WHICH F-105d's 0019 DELIBERATELY DID NOT
--
-- `CREATE OR REPLACE` CANNOT remove a default. Measured, on a throwaway
-- function on this database rather than read in a manual:
--
--     42P13 cannot remove parameter defaults from existing function
--
-- So a DROP is structurally required. That re-opens F-66 — a recreate takes
-- the creation-time ACL from Supabase's ALTER DEFAULT PRIVILEGES, silently
-- handing EXECUTE back to PUBLIC, anon, authenticated and service_role — which
-- is the exact mechanism that put F-105a and F-105d there in the first place.
-- So the ACL below is DECLARED IN FULL rather than left to whatever the
-- recreate inherits, and the companion probe asserts it. Nothing here is
-- allowed to be implicit; that is what the whole F-105 family is about.
--
-- SAFE TO DROP: pg_depend reports 0 non-pin dependents on either overload. The
-- only database caller, enroll_in_course(), names it from a plpgsql body and so
-- binds at run time, not at definition time; dropping and recreating within one
-- transaction invalidates its cached plan rather than breaking it.
--
-- ⚠ THE BODY BELOW IS NOT RETYPED AND NOT EDITED. It is the live prosrc,
-- F-105d's self-or-admin guard included, verified byte-identical before this
-- file was written:  md5 df71a90afca03692c1873846c72771cc, 3291 bytes.
-- This file changes ONE THING — the default — and a probe gate (G6) exists
-- solely to catch a future edit that quietly makes it a place to redefine the
-- function. 0016's G6 exists for the same reason and for the same function
-- family.
--
-- ⚠ FILENAME. 0020 and 0021 in this block are TAKEN ON main
-- (f98c_birthdays_carry_handle_and_close, f93_signup_handle_closure), so this
-- is 0022 — the next number free on BOTH branches. Related: main and staging
-- each already hold a DIFFERENT 20260910_0019. Reported to the Auditor; an
-- applied file is not renamed to tidy it up.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION public.process_referral_reward(uuid, text, numeric);

CREATE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text, _txn_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ── THE ACL, DECLARED IN FULL. See the F-66 note above: the DROP reset it. ──
-- REVOKE names every role including the two that are then granted, so the
-- final state is written here and does not depend on what the recreate
-- inherited. PUBLIC first — the empty grantee is the finding (F-62/F-98).
REVOKE ALL ON FUNCTION public.process_referral_reward(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text, numeric)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.process_referral_reward(uuid, text, numeric) IS
  'Credits a referral reward after a qualifying paid activity. Called by CompetitionSubmit.tsx for the caller''s own id, and by enroll_in_course() for the enrolling member. SELF-OR-ADMIN ONLY (F-105d). NO DEFAULT on _txn_amount (F-105e): the default made this an equally good candidate for a two-argument call, so PostgREST answered the admin Approve button with PGRST203 and the two-argument overload was unreachable. ⚠ _txn_amount is still supplied by the caller and gates the minimum-spend rule, so a member may clear that check for their OWN referral without having paid; closing that means moving this call server-side behind the submission RPC, and is deliberately NOT done here.';

COMMIT;
