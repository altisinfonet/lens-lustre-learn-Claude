-- Phase 1 Mutation #3 Step A: request_withdrawal RPC (Model A, debit-at-request)
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  _amount numeric,
  _bank_details jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_withdrawal_id uuid;
  v_pending_count int;
  v_wallet_error text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF _amount IS NULL OR _amount < 1 OR _amount > 50000 THEN
    RAISE EXCEPTION 'Amount must be between $1 and $50,000' USING ERRCODE = '22023';
  END IF;

  -- Advisory lock per-user to serialize concurrent withdrawal attempts
  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal:' || v_user_id::text, 0));

  -- Block if pending exists
  SELECT count(*) INTO v_pending_count
  FROM public.withdrawal_requests
  WHERE user_id = v_user_id AND status = 'pending';

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'You already have a pending withdrawal request' USING ERRCODE = 'P0001';
  END IF;

  -- Atomic: insert request first
  INSERT INTO public.withdrawal_requests (user_id, amount, bank_details, status)
  VALUES (v_user_id, _amount, _bank_details, 'pending')
  RETURNING id INTO v_withdrawal_id;

  -- Then debit wallet via canonical RPC (raises on insufficient funds)
  PERFORM public.wallet_transaction(
    _user_id := v_user_id,
    _type := 'withdrawal',
    _amount := -_amount,
    _description := 'Withdrawal request — $' || _amount::text,
    _reference_id := v_withdrawal_id,
    _reference_type := 'withdrawal_request'
  );

  -- Audit log
  INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (
    'withdrawal_requests',
    'INSERT',
    v_withdrawal_id,
    NULL,
    jsonb_build_object('amount', _amount, 'status', 'pending', 'user_id', v_user_id),
    v_user_id
  );

  RETURN v_withdrawal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, jsonb) TO service_role;