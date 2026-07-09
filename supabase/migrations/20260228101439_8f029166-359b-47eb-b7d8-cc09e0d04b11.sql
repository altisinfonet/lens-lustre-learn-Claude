
-- Function to process referral reward when referred user makes first paid activity
CREATE OR REPLACE FUNCTION public.process_referral_reward(_referred_user_id uuid, _activity_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _referral record;
  _reward numeric;
  _setting jsonb;
BEGIN
  -- Find pending referral for this user
  SELECT * INTO _referral
  FROM public.referrals
  WHERE referred_id = _referred_user_id AND status = 'pending'
  LIMIT 1;

  IF _referral IS NULL THEN RETURN; END IF;

  -- Get reward amount from settings (default $1.00)
  SELECT value INTO _setting FROM public.site_settings WHERE key = 'referral_reward';
  _reward := COALESCE((_setting->>'amount')::numeric, 1.00);

  -- Credit referrer wallet
  PERFORM wallet_transaction(
    _referral.referrer_id,
    'referral_earning',
    _reward,
    'Referral reward: invited user completed ' || _activity_type,
    _referral.id,
    'referral'
  );

  -- Update referral status
  UPDATE public.referrals
  SET status = 'rewarded', reward_amount = _reward, rewarded_at = now()
  WHERE id = _referral.id;
END;
$$;
