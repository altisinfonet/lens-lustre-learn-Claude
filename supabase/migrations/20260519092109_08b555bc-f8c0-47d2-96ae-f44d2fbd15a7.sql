-- Phase 1 Mutation #2 — Step A: admin_reject_wallet_transaction RPC (RPC only, no UI cutover)

CREATE OR REPLACE FUNCTION public.admin_reject_wallet_transaction(
  _admin_id uuid,
  _txn_id uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_user_id uuid;
  v_amount numeric;
  v_type text;
BEGIN
  -- Admin body check (authority lives in the function, not in GRANTs)
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'unauthorized: caller is not admin' USING ERRCODE = '42501';
  END IF;

  IF _txn_id IS NULL THEN
    RAISE EXCEPTION 'txn_id is required' USING ERRCODE = '22023';
  END IF;

  -- Lock row to prevent races with approve_deposit / concurrent rejects
  SELECT status, user_id, amount, type
    INTO v_current_status, v_user_id, v_amount, v_type
  FROM public.wallet_transactions
  WHERE id = _txn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_transaction % not found', _txn_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: already rejected -> success no-op
  IF v_current_status = 'rejected' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already', true,
      'txn_id', _txn_id,
      'status', 'rejected'
    );
  END IF;

  -- Only pending -> rejected is permitted. Anything else is a hard error.
  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'illegal state transition: status=% cannot be rejected (only pending allowed)', v_current_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.wallet_transactions
  SET
    status = 'rejected',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'rejected_by', _admin_id,
      'rejected_at', now(),
      'rejected_reason', _reason
    )
  WHERE id = _txn_id;

  INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (
    'wallet_transactions',
    'admin_reject_wallet_transaction',
    _txn_id::text,
    jsonb_build_object('status', v_current_status),
    jsonb_build_object(
      'status', 'rejected',
      'prev_status', v_current_status,
      'reason', _reason,
      'user_id', v_user_id,
      'amount', v_amount,
      'type', v_type
    ),
    _admin_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'already', false,
    'txn_id', _txn_id,
    'status', 'rejected',
    'prev_status', v_current_status
  );
END;
$$;

-- Lock down execution: admin authority is enforced inside the body
REVOKE EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text)
IS 'Phase 1 Mutation #2 Step A. Admin-only state-only reject of a pending wallet_transactions row. No money movement. Idempotent on already-rejected. Body-level has_role admin check + row lock. Audit row written to db_audit_logs. Rollback: DROP FUNCTION IF EXISTS public.admin_reject_wallet_transaction(uuid, uuid, text);';