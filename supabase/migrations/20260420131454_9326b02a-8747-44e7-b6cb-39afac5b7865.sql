-- ─── G1: Gift drift detector ───
CREATE OR REPLACE FUNCTION public.get_gift_drift_admin()
RETURNS TABLE (
  drift_type text,
  announcement_id uuid,
  user_id uuid,
  gift_credit_id uuid,
  expected_amount numeric,
  actual_amount numeric,
  is_expired boolean,
  created_at timestamptz,
  notes text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  -- A) Announcements with no matching wallet tx
  SELECT 'announcement_no_wallet_credit'::text,
    ga.id, ga.user_id, ga.gift_credit_id, ga.amount, NULL::numeric,
    ga.is_expired, ga.created_at,
    CASE WHEN ga.is_expired THEN 'Expired without crediting' ELSE 'Active gift not yet credited' END
  FROM gift_announcements ga
  WHERE NOT EXISTS (
    SELECT 1 FROM wallet_transactions wt
    WHERE wt.user_id = ga.user_id
      AND wt.reference_id = ga.gift_credit_id
      AND wt.type = 'gift'
      AND wt.status = 'completed'
  )
  UNION ALL
  -- B) Amount mismatch between announcement and wallet tx
  SELECT 'amount_mismatch'::text,
    ga.id, ga.user_id, ga.gift_credit_id, ga.amount, wt.amount,
    ga.is_expired, ga.created_at,
    'Wallet credit amount differs from announcement'
  FROM gift_announcements ga
  JOIN wallet_transactions wt
    ON wt.user_id = ga.user_id
   AND wt.reference_id = ga.gift_credit_id
   AND wt.type = 'gift'
   AND wt.status = 'completed'
  WHERE wt.amount <> ga.amount
  UNION ALL
  -- C) Wallet gift credit with no source announcement (orphan)
  SELECT 'orphan_wallet_credit'::text,
    NULL, wt.user_id, wt.reference_id, NULL::numeric, wt.amount,
    NULL::boolean, wt.created_at,
    'Wallet credited but no gift_announcement row exists'
  FROM wallet_transactions wt
  WHERE wt.type = 'gift'
    AND wt.status = 'completed'
    AND wt.reference_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM gift_announcements ga
      WHERE ga.user_id = wt.user_id AND ga.gift_credit_id = wt.reference_id
    );
END;
$$;

-- ─── G2: Referral drift detector ───
CREATE OR REPLACE FUNCTION public.get_referral_drift_admin()
RETURNS TABLE (
  drift_type text,
  referral_id uuid,
  referrer_id uuid,
  referred_id uuid,
  expected_amount numeric,
  actual_amount numeric,
  rewarded_at timestamptz,
  notes text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  -- A) Rewarded referral with no wallet credit
  SELECT 'rewarded_no_wallet_credit'::text,
    r.id, r.referrer_id, r.referred_id, r.reward_amount, NULL::numeric,
    r.rewarded_at, 'Referral marked rewarded but no wallet tx exists'
  FROM referrals r
  WHERE r.rewarded_at IS NOT NULL
    AND r.reward_amount > 0
    AND NOT EXISTS (
      SELECT 1 FROM wallet_transactions wt
      WHERE wt.user_id = r.referrer_id
        AND wt.reference_id = r.id
        AND wt.type = 'referral_bonus'
        AND wt.status = 'completed'
    )
  UNION ALL
  -- B) Amount mismatch
  SELECT 'amount_mismatch'::text,
    r.id, r.referrer_id, r.referred_id, r.reward_amount, wt.amount,
    r.rewarded_at, 'Referral wallet credit amount differs from reward_amount'
  FROM referrals r
  JOIN wallet_transactions wt
    ON wt.user_id = r.referrer_id
   AND wt.reference_id = r.id
   AND wt.type = 'referral_bonus'
   AND wt.status = 'completed'
  WHERE wt.amount <> r.reward_amount
  UNION ALL
  -- C) Orphan: wallet referral_bonus with no source referrals row
  SELECT 'orphan_wallet_credit'::text,
    wt.reference_id, wt.user_id, NULL::uuid, NULL::numeric, wt.amount,
    NULL::timestamptz, 'Wallet credited as referral_bonus but no referrals row exists'
  FROM wallet_transactions wt
  WHERE wt.type = 'referral_bonus'
    AND wt.status = 'completed'
    AND wt.reference_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM referrals r WHERE r.id = wt.reference_id
    );
END;
$$;

-- ─── G3: Admin fix — backfill missing gift wallet credit ───
CREATE OR REPLACE FUNCTION public.fix_gift_drift_admin(_announcement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_ann RECORD;
  v_new_balance numeric;
  v_tx_id uuid;
BEGIN
  IF NOT has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  SELECT user_id, gift_credit_id, amount, reason, is_expired
    INTO v_ann
  FROM gift_announcements WHERE id = _announcement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not found';
  END IF;

  IF v_ann.is_expired THEN
    RAISE EXCEPTION 'Cannot backfill an expired gift';
  END IF;

  -- Idempotency check
  IF EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE user_id = v_ann.user_id AND reference_id = v_ann.gift_credit_id
      AND type = 'gift' AND status = 'completed'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_credited');
  END IF;

  -- Atomic: update wallet, then insert tx
  INSERT INTO wallets (user_id, balance) VALUES (v_ann.user_id, v_ann.amount)
    ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + v_ann.amount, updated_at = now()
    RETURNING balance INTO v_new_balance;

  INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description, reference_id, reference_type, status)
  VALUES (v_ann.user_id, 'gift', v_ann.amount, v_new_balance,
          'Gift credit (admin backfill): ' || COALESCE(v_ann.reason, ''),
          v_ann.gift_credit_id, 'gift_credit', 'completed')
  RETURNING id INTO v_tx_id;

  INSERT INTO wallet_reconciliation_log
    (transaction_id, user_id, finding_type, amount, reference_id, reference_type, notes, reconciled_by, metadata)
  VALUES (v_tx_id, v_ann.user_id, 'gift_backfill', v_ann.amount,
          v_ann.gift_credit_id, 'gift_credit',
          'Backfilled missing gift wallet credit', v_admin,
          jsonb_build_object('announcement_id', _announcement_id));

  RETURN jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'balance', v_new_balance);
END;
$$;

-- ─── G4: Admin fix — backfill missing referral wallet credit ───
CREATE OR REPLACE FUNCTION public.fix_referral_drift_admin(_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_ref RECORD;
  v_new_balance numeric;
  v_tx_id uuid;
BEGIN
  IF NOT has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  SELECT referrer_id, referred_id, reward_amount, rewarded_at
    INTO v_ref
  FROM referrals WHERE id = _referral_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral not found';
  END IF;

  IF v_ref.rewarded_at IS NULL OR v_ref.reward_amount <= 0 THEN
    RAISE EXCEPTION 'Referral is not in a rewardable state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE user_id = v_ref.referrer_id AND reference_id = _referral_id
      AND type = 'referral_bonus' AND status = 'completed'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_credited');
  END IF;

  INSERT INTO wallets (user_id, balance) VALUES (v_ref.referrer_id, v_ref.reward_amount)
    ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + v_ref.reward_amount, updated_at = now()
    RETURNING balance INTO v_new_balance;

  INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description, reference_id, reference_type, status)
  VALUES (v_ref.referrer_id, 'referral_bonus', v_ref.reward_amount, v_new_balance,
          'Referral bonus (admin backfill)', _referral_id, 'referral', 'completed')
  RETURNING id INTO v_tx_id;

  INSERT INTO wallet_reconciliation_log
    (transaction_id, user_id, finding_type, amount, reference_id, reference_type, notes, reconciled_by, metadata)
  VALUES (v_tx_id, v_ref.referrer_id, 'referral_backfill', v_ref.reward_amount,
          _referral_id, 'referral',
          'Backfilled missing referral wallet credit', v_admin,
          jsonb_build_object('referred_id', v_ref.referred_id));

  RETURN jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'balance', v_new_balance);
END;
$$;