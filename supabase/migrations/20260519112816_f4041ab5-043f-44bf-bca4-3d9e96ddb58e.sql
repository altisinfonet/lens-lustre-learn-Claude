-- Phase 1 Mutation #4: soft-void replacement for hard-delete wallet paths
-- ACK: H3 GDPR exempt, H1 paired reversal, audit-log purge excludes wallet rows.

CREATE OR REPLACE FUNCTION public.soft_void_wallet_transactions(
  p_txn_ids uuid[],
  p_reason text,
  p_batch_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _voided_count int := 0;
  _reversed_count int := 0;
  _skipped int := 0;
  _txn record;
  _already_reversed boolean;
BEGIN
  -- Authority: service_role (auth.uid() IS NULL) or admin only
  IF _caller IS NOT NULL AND NOT has_role(_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'soft_void_wallet_transactions: admin/service_role only';
  END IF;

  IF p_txn_ids IS NULL OR array_length(p_txn_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'voided_count', 0,
      'reversed_count', 0,
      'skipped_already_voided', 0,
      'batch_id', p_batch_id
    );
  END IF;

  FOR _txn IN
    SELECT id, user_id, amount, type, status
    FROM public.wallet_transactions
    WHERE id = ANY(p_txn_ids)
    FOR UPDATE
  LOOP
    IF _txn.status = 'voided' THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    -- 1. Soft-void: flip status + merge audit metadata
    UPDATE public.wallet_transactions
    SET status = 'voided',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'voided_at', to_jsonb(now()),
          'voided_by', to_jsonb(_caller),
          'void_reason', to_jsonb(p_reason),
          'void_batch_id', to_jsonb(p_batch_id),
          'original_status', to_jsonb(_txn.status)
        )
    WHERE id = _txn.id;
    _voided_count := _voided_count + 1;

    -- 2. Idempotency check: skip reversal if one already exists for this original
    SELECT EXISTS(
      SELECT 1 FROM public.wallet_transactions
      WHERE reference_id = _txn.id AND type = 'void_reversal'
    ) INTO _already_reversed;

    IF NOT _already_reversed THEN
      -- 3. Paired reversing row via canonical wallet_transaction() RPC.
      --    Sign-flip restores wallets.balance atomically.
      PERFORM public.wallet_transaction(
        _txn.user_id,
        'void_reversal',
        -_txn.amount,
        'Reversal of voided txn ' || _txn.id::text || ' (' || p_reason || ')',
        _txn.id,
        'void_reversal',
        jsonb_build_object(
          'void_batch_id', p_batch_id,
          'original_txn_id', _txn.id,
          'original_type', _txn.type,
          'original_amount', _txn.amount,
          'void_reason', p_reason
        )
      );
      _reversed_count := _reversed_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'voided_count', _voided_count,
    'reversed_count', _reversed_count,
    'skipped_already_voided', _skipped,
    'batch_id', p_batch_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_wt_status_voided
  ON public.wallet_transactions(status) WHERE status = 'voided';

COMMENT ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) IS
  'Phase 1 Mut #4: Soft-void wallet_transactions + emit paired void_reversal rows. service_role/admin only. Idempotent on (reference_id, type=void_reversal).';