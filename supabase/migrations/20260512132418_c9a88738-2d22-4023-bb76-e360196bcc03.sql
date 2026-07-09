-- RLS-HOTFIX-5 Step 1: Additive SECURITY DEFINER RPC for pending deposits.
-- No table, no policy, no existing function is modified. Fully reversible by DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.create_pending_deposit(
  _user_id          uuid,
  _amount           numeric,
  _gateway          text,
  _reference        text,
  _metadata         jsonb DEFAULT '{}'::jsonb,
  _idempotency_key  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _txn_id        uuid;
  _existing      uuid;
  _key           text;
  _gateway_label text;
  _safe_ref      text;
BEGIN
  -- 1. Authority: caller must be the user themselves OR service-role (auth.uid() IS NULL).
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate gateway
  IF _gateway NOT IN ('upi','bank_transfer') THEN
    RAISE EXCEPTION 'Invalid gateway: %', _gateway USING ERRCODE = '22023';
  END IF;

  -- 3. Validate amount (matches submit-deposit edge fn: $1..$50,000)
  IF _amount IS NULL OR _amount < 1 OR _amount > 50000 THEN
    RAISE EXCEPTION 'Amount out of range' USING ERRCODE = '22003';
  END IF;

  -- 4. Validate reference
  IF _reference IS NULL OR length(btrim(_reference)) = 0 THEN
    RAISE EXCEPTION 'Reference required' USING ERRCODE = '22023';
  END IF;
  _safe_ref := left(btrim(_reference), 200);

  _gateway_label := CASE _gateway WHEN 'upi' THEN 'UPI' ELSE 'Bank Transfer' END;
  _key := COALESCE(_idempotency_key, _gateway || ':' || _safe_ref);

  -- 5. Idempotency: same user + same key in last 24h returns the existing txn id.
  SELECT id INTO _existing
  FROM public.wallet_transactions
  WHERE user_id = _user_id
    AND type   = 'deposit'
    AND status = 'pending'
    AND metadata->>'idempotency_key' = _key
    AND created_at > now() - interval '24 hours'
  LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  -- 6. Rate limit: 2000 txns/user/hour (mirrors wallet_transaction).
  IF (SELECT COUNT(*) FROM public.wallet_transactions
        WHERE user_id = _user_id
          AND created_at > now() - interval '1 hour') >= 2000 THEN
    RAISE EXCEPTION 'Rate limit exceeded' USING ERRCODE = '54000';
  END IF;

  -- 7. Insert pending row. Frozen shape — does NOT touch wallets.balance.
  INSERT INTO public.wallet_transactions
    (user_id, type, amount, balance_after, description, status, metadata,
     reference_id, reference_type)
  VALUES
    (_user_id,
     'deposit',
     _amount,
     0,
     _gateway_label || ' deposit — Ref: ' || _safe_ref,
     'pending',
     COALESCE(_metadata, '{}'::jsonb)
       || jsonb_build_object(
            'gateway',         _gateway,
            'idempotency_key', _key,
            'submitted_at',    now()
          ),
     NULL,
     NULL)
  RETURNING id INTO _txn_id;

  RETURN _txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_pending_deposit(uuid,numeric,text,text,jsonb,text) IS
'RLS-HOTFIX-5 Step 1: Server-side pending deposit creator. SECURITY DEFINER. Inserts wallet_transactions row with status=pending, balance_after=0; never mutates wallets.balance. Self-only auth or service-role. Idempotent on (user_id, idempotency_key) within 24h.';
