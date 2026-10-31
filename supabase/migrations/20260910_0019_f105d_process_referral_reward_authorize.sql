-- ═══════════════════════════════════════════════════════════════════════════
-- F-105d — process_referral_reward TRUSTED ITS CALLER'S CLAIM ABOUT WHO IT WAS.
--
-- The last open half of F-105. F-105a closed get_todays_birthdays (0016),
-- F-105c closed the four friend-graph readers (0017, 0018). Those four were
-- REVOKES: nothing in the app called them as a member, so the grant could
-- simply go. **This one cannot be a revoke, and that is the whole difficulty.**
-- (F-105b is not a letter used anywhere in this repository; d is taken next so
-- no letter that may exist in the Auditor's notes is re-used.)
--
-- WHAT IS WRONG
--
-- Both overloads are SECURITY DEFINER, VOLATILE, and hold EXECUTE for PUBLIC,
-- anon and authenticated. Both take `_referred_user_id uuid` from the caller
-- and never compare it to auth.uid() — the string does not appear in either
-- body. Both call wallet_transaction(), which ISSUES THE CREDIT. So any signed
-- in member could POST
--
--     /rest/v1/rpc/process_referral_reward
--       { "_referred_user_id": "<somebody else's id>", "_activity_type": "x" }
--
-- and move money: the referrer of that member is credited referrer_amount, the
-- member themselves credited referee_bonus, and the referrals row is flipped to
-- 'rewarded'. The member being spent does not appear in the request at all.
--
-- Recorded by the Auditor in PROMOTION_LEDGER §44.5 as **"ARMED, NOT LOADED"**:
-- production has zero referral rows and no referral_reward setting, so today
-- the function returns at its first statement. That sizing is about the DATA,
-- not the CODE. The first referral row loads it.
--
-- WHY A REVOKE WOULD BE AN OUTAGE — the D2 call-site inventory, re-measured
--
-- Two real client callers exist, and they are NOT the same caller:
--
--   src/pages/CompetitionSubmit.tsx:328   -> the THREE-argument overload,
--       `_referred_user_id: user.id` — the caller's OWN id, always.
--   src/components/admin/AdminReferrals.tsx:124 -> the TWO-argument overload,
--       `_referred_user_id: ref.referred_id` — SOMEBODY ELSE'S id, on the
--       admin Approve button.
--
-- A blanket REVOKE FROM authenticated takes both features down. So the fix is
-- an authorisation check INSIDE the function, and the two call sites tell us
-- exactly what it has to permit: self, and admin. Nothing else.
--
-- THE THIRD CALLER, WHICH IS THE ONE THAT COULD HAVE BEEN BROKEN SILENTLY
--
-- public.enroll_in_course(uuid, uuid) calls the three-argument overload:
--
--     BEGIN
--       PERFORM process_referral_reward(_user_id, 'course purchase', _course.price);
--     EXCEPTION WHEN OTHERS THEN NULL;
--     END;
--
-- **That EXCEPTION WHEN OTHERS THEN NULL swallows anything this migration
-- raises.** A wrong guard here would not fail loudly; course-purchase referral
-- rewards would just stop happening, with nothing in any log. So its permitted
-- callers were read rather than assumed, from pg_proc.prosrc on staging:
--
--     IF _user_id <> auth.uid() AND NOT has_role(auth.uid(), 'admin'::app_role)
--       THEN RAISE EXCEPTION 'Not authorized: you can only enroll yourself';
--
-- enroll_in_course ALREADY permits exactly two cases — caller enrolling
-- themselves, or an admin enrolling somebody. Both satisfy the guard below,
-- so the nested call cannot break. The predicate is not merely compatible with
-- the existing one: it is the same predicate, which is why it is safe.
--
-- No other caller exists. Verified: pg_proc.prosrc across public (one hit,
-- enroll_in_course), cron.job (zero), supabase/functions/ and functions/
-- (zero), src/ (the two above).
--
-- WHY `CREATE OR REPLACE` AND NOT `DROP` + `CREATE`
--
-- F-66, and 0016's header states it: a DROP+CREATE resets the ACL to the
-- creation-time default, which on this project means PUBLIC + anon +
-- authenticated + service_role all come back silently via
-- ALTER DEFAULT PRIVILEGES. CREATE OR REPLACE PRESERVES the existing ACL.
-- The revokes below are therefore written as the deliberate ACL change, not
-- left to be an accident of which DDL verb was used.
--
-- WHAT THIS DOES *NOT* CLOSE — SAID PLAINLY, NOT LEFT TO BE DISCOVERED
--
-- The three-argument overload gates the minimum-spend rule on `_txn_amount`,
-- a number the BROWSER supplies:
--
--     IF _txn_amount > 0 AND _txn_amount < _min_amount THEN RETURN; END IF;
--
-- After this migration a member can still call it for THEIR OWN id with any
-- _txn_amount they like and clear that check without having paid anything,
-- collecting referee_bonus for themselves and referrer_amount for their
-- referrer. The monthly cap bounds it; it does not close it.
--
-- **This migration is an authorisation fix and is labelled as one.** The
-- amount-trust defect is a different fault with a different fix: the reward
-- belongs behind the submission RPC that actually took the money, the way
-- enroll_in_course already does it for courses, with the browser not calling
-- this function at all. That removes a client call site (D2's lane, a frozen
-- interface and its own unit) and must not be smuggled in here.
--
-- Likewise NOT changed here: the two-argument overload has no enabled check,
-- no minimum check, no manual-approval check and no monthly-cap check
-- (LEDGER §44.5). That is arguably correct for an admin override — an admin
-- approving a referral that manual_approval deliberately held back is the
-- whole point of the button — but it has never been written down as a
-- decision. Reported to the Auditor, not decided by me.
--
-- ⚠ ONE THING FOUND WHILE WRITING THE PROBE, WHICH IS NOT THIS UNIT'S TO FIX
--
-- The two overloads cannot be told apart by a two-argument SQL call:
--
--     process_referral_reward(uuid, text)
--       -> 42725 function public.process_referral_reward(uuid, text) is not unique
--
-- because the 3-arg overload's `_txn_amount numeric DEFAULT 0` makes it an
-- equally good candidate. Named notation gives the same error. Measured on
-- staging, both forms, 2026-09-12.
--
-- So from SQL the 2-arg overload is UNREACHABLE. PostgREST resolves overloads
-- by matching the request's JSON keys to parameter names rather than by SQL's
-- rules, which is presumably how AdminReferrals.tsx:124 reaches it — but
-- **that has not been measured**, and if PostgREST cannot disambiguate either,
-- the admin Approve button is already failing with 42725 and has been since
-- the 3-arg overload was added. That is a live question for D2 and the
-- Auditor, not something to answer by guessing here.
--
-- It changes nothing about this fix: the guard goes on BOTH bodies, so the
-- authorisation outcome is the same whichever one a caller resolves to.
--
-- VERIFICATION IS pg_proc.proacl AND A REAL CROSS-MEMBER CALL, never
-- has_function_privilege (C-89). See PROBE_f105d_process_referral_reward_authorized.sql.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text)
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
$function$;

CREATE OR REPLACE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text, _txn_amount numeric DEFAULT 0)
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

-- ── THE ACL. authenticated KEEPS EXECUTE; both call sites need it. ──────────
-- PUBLIC and anon do not. The function is VOLATILE and moves money, which is
-- the one thing anon must never reach (and the guard above would refuse a NULL
-- auth.uid() anyway — this is the second lock, not the only one).
--
-- WHY `FROM PUBLIC, anon` AND PUBLIC FIRST — F-62/F-98. The empty grantee is
-- the finding. `REVOKE ... FROM anon` alone removes anon's own entry, leaves
-- `=X/postgres` standing, and the function stays reachable by anon THROUGH
-- PUBLIC while the catalogue looks changed.

REVOKE ALL ON FUNCTION public.process_referral_reward(uuid, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_referral_reward(uuid, text, numeric) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.process_referral_reward(uuid, text) IS
  'Credits a referral reward. The ADMIN Approve button''s overload (AdminReferrals.tsx) — it is called with somebody else''s id by design. SELF-OR-ADMIN ONLY (F-105d): SECURITY DEFINER and calls wallet_transaction(), so before this guard any signed-in member could credit any account by naming it. Revoked from PUBLIC and anon; authenticated retains EXECUTE because the guard, not the grant, is the control.';

COMMENT ON FUNCTION public.process_referral_reward(uuid, text, numeric) IS
  'Credits a referral reward after a qualifying paid activity. Called by CompetitionSubmit.tsx for the caller''s own id, and by enroll_in_course() for the enrolling member. SELF-OR-ADMIN ONLY (F-105d). ⚠ _txn_amount is still supplied by the caller and gates the minimum-spend rule, so a member may clear that check for their OWN referral without having paid; closing that means moving this call server-side behind the submission RPC, and is deliberately NOT done here.';

COMMIT;
