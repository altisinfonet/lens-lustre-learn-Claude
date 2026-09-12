-- F-105d + F-105e ROLLBACK (production, re-derived) — RESTORES BOTH DEFECTS.
--
-- Returns public.process_referral_reward to the state run #69 MEASURED on
-- production: the bootstrap-snapshot bodies, with no self-or-admin guard, and
-- `_txn_amount numeric DEFAULT 0` back on the three-argument overload. After
-- running it:
--
--   * any signed-in member can again credit any account by naming it in
--     _referred_user_id (F-105d), on a SECURITY DEFINER function that calls
--     wallet_transaction(); and
--   * PostgREST cannot choose between the overloads again, so the admin Approve
--     button returns HTTP 300 PGRST203 and approves nothing (F-105e).
--
-- It exists because every apply file ships with its rollback. There is no
-- circumstance in which running it is the right move.
--
-- ⚠ THIS ROLLBACK TARGETS A DIFFERENT PRE-STATE FROM 0023's. 0023's rollback
-- restored main's stale 20260228 bodies; this one restores the bootstrap
-- snapshot bodies, because that is what production actually runs. Running the
-- WRONG rollback would silently strip BUG-049 (the FOR UPDATE lock) and
-- BUG-047 (the self-referral guard) from production — both of which it has.
-- 0023 and its rollback are superseded and should not be run.
--
--   2-arg restored to md5 7999749b88688973dc95680d68ae5e86 (1416 bytes)
--   3-arg restored to md5 5a69d3fa10a09745b9bfd1a5a7d48690 (2224 bytes)
--
-- The 2-arg value is MEASURED (run #69). The 3-arg value is INFERRED and is
-- only correct if 0024's P2b gate passed on the way in — which is the only
-- circumstance in which this file would ever be run.
--
-- THE ACL IS RESTORED TO THE SUPABASE DEFAULT DELIBERATELY: PUBLIC, anon,
-- authenticated and service_role all holding EXECUTE. That is the pre-0024
-- truth, not an improvement on it. A rollback that quietly kept the revokes
-- would land in a state that is neither the before nor the after, with nothing
-- to say so.
--
-- ONE TRANSACTION, for the same reason 0024 is: the DROP resets the ACL and the
-- window between the recreate and the grants must not be observable.
--
-- Bodies sliced from staging's 20260911101721 bootstrap snapshot — not retyped.

BEGIN;

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
BEGIN
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

DROP FUNCTION public.process_referral_reward(uuid, text, numeric);

CREATE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text, _txn_amount numeric DEFAULT 0)
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
  _enabled boolean;
  _min_amount numeric;
  _monthly_cap integer;
  _manual_approval boolean;
  _month_count integer;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text)          TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text, numeric) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
