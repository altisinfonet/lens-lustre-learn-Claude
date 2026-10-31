
-- Wallets table: one per user
CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wallet" ON public.wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert wallets" ON public.wallets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage wallets" ON public.wallets
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Wallet transactions ledger
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  balance_after numeric NOT NULL DEFAULT 0,
  description text,
  reference_id uuid,
  reference_type text,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage transactions" ON public.wallet_transactions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert transactions" ON public.wallet_transactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Withdrawal requests
CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  bank_details jsonb,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own withdrawals" ON public.withdrawal_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create withdrawals" ON public.withdrawal_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage withdrawals" ON public.withdrawal_requests
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Exchange rate settings
CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settings" ON public.site_settings
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage settings" ON public.site_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert default exchange rate
INSERT INTO public.site_settings (key, value) VALUES ('usd_to_inr_rate', '{"rate": 83.5, "source": "manual", "auto_fetch": true}');

-- Function to credit/debit wallet atomically
CREATE OR REPLACE FUNCTION public.wallet_transaction(
  _user_id uuid,
  _type text,
  _amount numeric,
  _description text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _reference_type text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _wallet_id uuid;
  _new_balance numeric;
  _txn_id uuid;
BEGIN
  -- Ensure wallet exists
  INSERT INTO public.wallets (user_id, balance)
  VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock and update balance
  UPDATE public.wallets
  SET balance = balance + _amount,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING balance INTO _new_balance;

  -- Prevent negative balance
  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  -- Record transaction
  INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, description, reference_id, reference_type, status, metadata)
  VALUES (_user_id, _type, _amount, _new_balance, _description, _reference_id, _reference_type, 'completed', _metadata)
  RETURNING id INTO _txn_id;

  RETURN _txn_id;
END;
$$;

-- Admin function to credit any user (prizes, gifts, refunds, honorarium)
CREATE OR REPLACE FUNCTION public.admin_wallet_credit(
  _admin_id uuid,
  _target_user_id uuid,
  _amount numeric,
  _type text,
  _description text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _reference_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT has_role(_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can credit wallets';
  END IF;

  RETURN wallet_transaction(_target_user_id, _type, _amount, _description, _reference_id, _reference_type);
END;
$$;
