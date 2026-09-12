-- F-105e ROLLBACK — PUTS THE DEFAULT BACK, AND WITH IT THE OUTAGE.
--
-- Running this restores `_txn_amount numeric DEFAULT 0`, which makes the
-- three-argument function an equally good candidate for a two-argument call
-- again. PostgREST then answers the admin Approve button with
--
--     HTTP 300  PGRST203  Could not choose the best candidate function
--
-- exactly as it did before 0022. There is no circumstance in which that is
-- the desired state; this file exists because every apply file ships with its
-- rollback, and for no other reason.
--
-- The body is the same live prosrc 0022 installs (F-105d's self-or-admin guard
-- included), md5 df71a90afca03692c1873846c72771cc, 3291 bytes — so running
-- this rolls back the DEFAULT and NOTHING ELSE. It does not reopen F-105d.
--
-- The ACL is declared in full for the same reason 0022 declares it: this file
-- also drops and recreates, so it also inherits Supabase's ALTER DEFAULT
-- PRIVILEGES grants unless it says otherwise (F-66).

BEGIN;

DROP FUNCTION public.process_referral_reward(uuid, text, numeric);

CREATE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text, _txn_amount numeric DEFAULT 0)
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

REVOKE ALL ON FUNCTION public.process_referral_reward(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text, numeric)
  TO authenticated, service_role;

COMMIT;
