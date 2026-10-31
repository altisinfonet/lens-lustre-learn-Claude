
-- Rate limiting trigger for competition entries: max 5 submissions per user per hour
CREATE OR REPLACE FUNCTION public.rate_limit_competition_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.competition_entries
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 5 competition submissions per hour';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rate_limit_competition_entry
  BEFORE INSERT ON public.competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.rate_limit_competition_entry();

-- Rate limiting for wallet transactions: max 20 transactions per user per hour
-- Applied inside the wallet_transaction function by replacing it
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
BEGIN
  -- Rate limit: max 20 transactions per user per hour
  SELECT COUNT(*) INTO _recent_count
  FROM public.wallet_transactions
  WHERE user_id = _user_id
    AND created_at > now() - interval '1 hour';

  IF _recent_count >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 20 wallet transactions per hour';
  END IF;

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
