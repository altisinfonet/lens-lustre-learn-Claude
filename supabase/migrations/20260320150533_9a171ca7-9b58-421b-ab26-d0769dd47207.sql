-- Harden wallet_transaction to only allow self-transactions from direct RPC calls.
-- Cross-user transactions must go through admin_wallet_credit or a trusted edge function.

-- Drop all overloads first, then recreate with caller check
DROP FUNCTION IF EXISTS public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.wallet_transaction(uuid, text, numeric, text, uuid, text);

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
SET search_path = public
AS $$
DECLARE
  _wallet_id uuid;
  _new_balance numeric;
  _txn_id uuid;
  _recent_count integer;
  _caller_id uuid;
BEGIN
  _caller_id := auth.uid();

  -- If called by an authenticated user (not service role), only allow self-transactions
  -- Service role calls have auth.uid() = NULL
  IF _caller_id IS NOT NULL AND _caller_id IS DISTINCT FROM _user_id THEN
    -- Only admins can transact on behalf of others via direct RPC
    IF NOT has_role(_caller_id, 'admin'::app_role) THEN
      RAISE EXCEPTION 'Permission denied: cannot modify another user''s wallet';
    END IF;
  END IF;

  SELECT COUNT(*) INTO _recent_count
  FROM public.wallet_transactions
  WHERE user_id = _user_id
    AND created_at > now() - interval '1 hour';

  IF _recent_count >= 2000 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 2000 wallet transactions per hour';
  END IF;

  INSERT INTO public.wallets (user_id, balance)
  VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets
  SET balance = balance + _amount,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING balance INTO _new_balance;

  -- Allow negative balance for penalty deductions (unvote_penalty type)
  IF _new_balance < 0 AND _type NOT IN ('unvote_penalty') THEN
    UPDATE public.wallets
    SET balance = balance - _amount,
        updated_at = now()
    WHERE user_id = _user_id;
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, description, reference_id, reference_type, status, metadata)
  VALUES (_user_id, _type, _amount, _new_balance, _description, _reference_id, _reference_type, 'completed', _metadata)
  RETURNING id INTO _txn_id;

  RETURN _txn_id;
END;
$$;