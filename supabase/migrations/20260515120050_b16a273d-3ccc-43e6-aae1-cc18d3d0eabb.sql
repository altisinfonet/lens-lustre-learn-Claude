-- Phase 1A Step C0 — Canary Blocker Resolution
-- 1. Append-only v2 ledger rows table
-- 2. Replace branch F of wallet_ledger_apply_v2 (live path inserts ONLY into wallet_ledger_v2_rows)
-- No mutation of wallets; no insert into wallet_transactions; no caller flips.

-- =========================================================
-- A. wallet_ledger_v2_rows — append-only mirror
-- =========================================================
CREATE TABLE IF NOT EXISTS public.wallet_ledger_v2_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op                text NOT NULL,
  user_id           uuid NOT NULL,
  amount            numeric NOT NULL,
  idempotency_key   text NOT NULL,
  description       text,
  reference_id      text,
  source_path       text,
  balance_before    numeric NOT NULL,
  balance_after     numeric NOT NULL,
  actor_user_id     uuid,
  jwt_role          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_ledger_v2_rows_op_idem_unique UNIQUE (op, idempotency_key)
);

CREATE INDEX IF NOT EXISTS wallet_ledger_v2_rows_user_id_created_at_idx
  ON public.wallet_ledger_v2_rows (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_ledger_v2_rows_op_created_at_idx
  ON public.wallet_ledger_v2_rows (op, created_at DESC);

ALTER TABLE public.wallet_ledger_v2_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read wallet_ledger_v2_rows" ON public.wallet_ledger_v2_rows;
CREATE POLICY "Admins read wallet_ledger_v2_rows"
  ON public.wallet_ledger_v2_rows
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- No INSERT/UPDATE/DELETE policies. Writes only via SECURITY DEFINER fn.
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_v2_rows FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_v2_rows FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_v2_rows FROM authenticated;

COMMENT ON TABLE public.wallet_ledger_v2_rows IS
  'Phase 1A Step C0: append-only parallel ledger mirror. Written exclusively by wallet_ledger_apply_v2 branch F (live path). Never mutates wallets or wallet_transactions. Admin-only SELECT.';

-- =========================================================
-- B. Replace wallet_ledger_apply_v2 — branches A-E byte-identical, branch F now LIVE
-- =========================================================
CREATE OR REPLACE FUNCTION public.wallet_ledger_apply_v2(
  p_op text,
  p_user_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_description text DEFAULT NULL::text,
  p_reference_id text DEFAULT NULL::text,
  p_source_path text DEFAULT NULL::text,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_balance_before numeric;
  v_balance_after  numeric;
  v_existing       public.wallet_ledger_idempotency%ROWTYPE;
  v_actor          uuid := auth.uid();
  v_role           text := current_setting('request.jwt.claim.role', true);
  v_v2_row_id      uuid;
BEGIN
  -- A. Input validation
  IF p_op IS NULL OR length(trim(p_op)) = 0
     OR p_user_id IS NULL
     OR p_amount IS NULL
     OR p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, error_code, error_message, dry_run, source_path
    ) VALUES (
      COALESCE(p_op,'<null>'), v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'error', 'INVALID_INPUT',
      'op/user_id/amount/idempotency_key required and non-empty',
      p_dry_run, p_source_path
    );
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_INPUT');
  END IF;

  -- B. Idempotency replay
  SELECT * INTO v_existing
    FROM public.wallet_ledger_idempotency
   WHERE op = p_op AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, balance_after, dry_run, source_path
    ) VALUES (
      p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'replay', v_existing.result_balance_after, p_dry_run, p_source_path
    );
    RETURN jsonb_build_object(
      'ok', true, 'replay', true,
      'balance_after', v_existing.result_balance_after,
      'txn_id', v_existing.result_txn_id
    );
  END IF;

  -- C. Read current balance (no mutation)
  SELECT COALESCE(balance, 0) INTO v_balance_before
    FROM public.wallets WHERE user_id = p_user_id;
  IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;
  v_balance_after := v_balance_before + p_amount;

  -- D. Overdraft guard
  IF v_balance_after < 0 THEN
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, error_code, error_message,
      balance_before, dry_run, source_path
    ) VALUES (
      p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'error', 'OVERDRAFT',
      'insufficient balance: would result in negative wallet',
      v_balance_before, p_dry_run, p_source_path
    );
    RETURN jsonb_build_object(
      'ok', false, 'error_code', 'OVERDRAFT',
      'balance_before', v_balance_before, 'amount', p_amount
    );
  END IF;

  -- E. DRY RUN PATH — log only
  IF p_dry_run THEN
    INSERT INTO public.wallet_ledger_shadow_log(
      source_path, op, idempotency_key, intended_user_id, intended_amount,
      computed_balance_before, computed_balance_after, validation_ok
    ) VALUES (
      p_source_path, p_op, p_idempotency_key, p_user_id, p_amount,
      v_balance_before, v_balance_after, true
    );
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, balance_before, balance_after, dry_run, source_path
    ) VALUES (
      p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'dry_run_ok', v_balance_before, v_balance_after, true, p_source_path
    );
    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true,
      'balance_before', v_balance_before,
      'balance_after',  v_balance_after
    );
  END IF;

  -- F. LIVE PATH — append-only insert into wallet_ledger_v2_rows ONLY.
  --    NO update on wallets. NO insert into wallet_transactions.
  INSERT INTO public.wallet_ledger_v2_rows (
    op, user_id, amount, idempotency_key, description, reference_id, source_path,
    balance_before, balance_after, actor_user_id, jwt_role
  ) VALUES (
    p_op, p_user_id, p_amount, p_idempotency_key, p_description, p_reference_id, p_source_path,
    v_balance_before, v_balance_after, v_actor, v_role
  )
  ON CONFLICT (op, idempotency_key) DO NOTHING
  RETURNING id INTO v_v2_row_id;

  IF v_v2_row_id IS NULL THEN
    -- Race-window replay: another concurrent call won the insert.
    SELECT balance_after INTO v_balance_after
      FROM public.wallet_ledger_v2_rows
     WHERE op = p_op AND idempotency_key = p_idempotency_key;

    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, balance_after, dry_run, source_path
    ) VALUES (
      p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'replay', v_balance_after, false, p_source_path
    );
    RETURN jsonb_build_object('ok', true, 'replay', true, 'balance_after', v_balance_after);
  END IF;

  -- Mirror into idempotency registry (parity with legacy replay branch B).
  INSERT INTO public.wallet_ledger_idempotency(
    op, idempotency_key, result_txn_id, result_balance_after
  ) VALUES (
    p_op, p_idempotency_key, NULL, v_balance_after
  )
  ON CONFLICT (op, idempotency_key) DO NOTHING;

  INSERT INTO public.wallet_ledger_audit_log(
    op, actor_user_id, target_user_id, amount, idempotency_key,
    request_jwt_role, result, balance_before, balance_after, dry_run, source_path
  ) VALUES (
    p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
    v_role, 'live_ok', v_balance_before, v_balance_after, false, p_source_path
  );

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false,
    'balance_before', v_balance_before,
    'balance_after',  v_balance_after,
    'v2_row_id', v_v2_row_id
  );
END;
$function$;

-- Re-assert lockdown (REVOKE ALL — no client may call directly; only SECURITY DEFINER callers)
REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) IS
  'Phase 1A Step C0: branch F now writes append-only to wallet_ledger_v2_rows when p_dry_run=false. No production caller currently passes p_dry_run=false. Legacy wallet_transaction() remains the sole authority on wallets/wallet_transactions.';