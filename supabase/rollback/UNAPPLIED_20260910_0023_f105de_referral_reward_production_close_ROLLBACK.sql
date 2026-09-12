-- ═══════════════════════════════════════════════════════════════════════════
-- ⛔ WITHDRAWN 2026-09-12. DO NOT RUN THIS FILE, NOW OR EVER. IT IS THE MOST
--    DANGEROUS FILE IN THIS DIRECTORY.
--
-- SUPERSEDED BY
--   supabase/rollback/20260910_0024_f105de_referral_reward_production_close_ROLLBACK.sql
--
-- Its migration (UNAPPLIED_20260910_0023_…) never applied — run #69's
-- precondition gate refused it. A rollback has NO SUCH GATE. Run by hand
-- against production this file would, in one transaction and without objecting:
--
--   1. REPLACE both bodies with main's stale 20260228 versions, STRIPPING
--      BUG-049 (the FOR UPDATE lock that stops a double-credit) and BUG-047
--      (the guard that stops a self-referral being rewarded). Run #70 measured
--      production carrying both.
--
--   2. GRANT EXECUTE TO PUBLIC AND anon on a VOLATILE SECURITY DEFINER function
--      that calls wallet_transaction(). Run #70 measured production's ACL as
--      `postgres | service_role | authenticated` — no PUBLIC, no anon. This
--      file would not restore that state; it would open it.
--
-- Both faults come from the same root: it was written from main's migration
-- source and from an assumption about Supabase's default ACL, and neither
-- described production. Neither was measured at the time. Both have been since.
--
-- A rollback that leaves the system more open than it found it is not a
-- rollback. Retained under the UNAPPLIED_ prefix for the audit trail only.
--
-- Original header follows, unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

-- F-105d + F-105e ROLLBACK (production) — RESTORES BOTH DEFECTS. Read first.
--
-- This returns public.process_referral_reward to EXACTLY the state main's own
-- 20260228101821 and 20260228102118 define: no self-or-admin guard, and
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
-- circumstance in which running it is the right move. If 0023 broke a caller,
-- the fix is to name that caller in a new migration.
--
-- THE ACL IS RESTORED TO THE SUPABASE DEFAULT DELIBERATELY, because that is
-- what production had before 0023 — PUBLIC, anon, authenticated and
-- service_role all holding EXECUTE. That is the pre-0023 truth, not an
-- improvement on it; a rollback that quietly kept the revokes would be a
-- different state from the one being rolled back to, and the next reader would
-- have no way to tell.
--
-- ONE TRANSACTION, for the same reason 0023 is: the DROP resets the ACL, and
-- the window between the recreate and the grants must not be observable.
--
-- Bodies sliced from main's 20260228101821 (2-arg, md5 a82168c949cbc3eef0dad32e17961730) and
-- 20260228102118 (3-arg, md5 12b13af9a3bfce42f6294d12d3e7d9cf) — not retyped.

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

GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text)          TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid, text, numeric) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
