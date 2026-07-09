-- =========================================================================
-- PHASE 1A — STEP A1 — wallet_ledger_apply_v2 SHADOW INFRASTRUCTURE
-- Additive only. No existing object touched. REVOKE ALL by default.
-- Live branch stubbed (RAISE) — only dry_run path is functional.
-- =========================================================================

-- 1) Idempotency table -----------------------------------------------------
CREATE TABLE public.wallet_ledger_idempotency (
  op               text        NOT NULL,
  idempotency_key  text        NOT NULL,
  result_txn_id    uuid,
  result_balance_after numeric,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (op, idempotency_key)
);
ALTER TABLE public.wallet_ledger_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read wallet_ledger_idempotency"
  ON public.wallet_ledger_idempotency FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Shadow log ------------------------------------------------------------
CREATE TABLE public.wallet_ledger_shadow_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path              text,
  op                       text NOT NULL,
  idempotency_key          text,
  intended_user_id         uuid,
  intended_amount          numeric,
  computed_balance_before  numeric,
  computed_balance_after   numeric,
  validation_ok            boolean,
  error_code               text,
  error_message            text,
  captured_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wlsl_op_key       ON public.wallet_ledger_shadow_log(op, idempotency_key);
CREATE INDEX idx_wlsl_captured_at  ON public.wallet_ledger_shadow_log(captured_at DESC);
ALTER TABLE public.wallet_ledger_shadow_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read wallet_ledger_shadow_log"
  ON public.wallet_ledger_shadow_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Audit log -------------------------------------------------------------
CREATE TABLE public.wallet_ledger_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op                text NOT NULL,
  actor_user_id     uuid,
  target_user_id    uuid,
  amount            numeric,
  idempotency_key   text,
  request_jwt_role  text,
  result            text NOT NULL,           -- 'dry_run_ok' | 'replay' | 'error' | 'live_ok'
  error_code        text,
  error_message     text,
  balance_before    numeric,
  balance_after     numeric,
  dry_run           boolean NOT NULL,
  source_path       text,
  captured_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wlal_op_result     ON public.wallet_ledger_audit_log(op, result);
CREATE INDEX idx_wlal_captured_at   ON public.wallet_ledger_audit_log(captured_at DESC);
CREATE INDEX idx_wlal_target_user   ON public.wallet_ledger_audit_log(target_user_id);
ALTER TABLE public.wallet_ledger_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read wallet_ledger_audit_log"
  ON public.wallet_ledger_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) Canonical RPC (shadow-only build) -------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_ledger_apply_v2(
  p_op              text,
  p_user_id         uuid,
  p_amount          numeric,
  p_idempotency_key text,
  p_description     text    DEFAULT NULL,
  p_reference_id    text    DEFAULT NULL,
  p_source_path     text    DEFAULT NULL,
  p_dry_run         boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_before numeric;
  v_balance_after  numeric;
  v_existing       public.wallet_ledger_idempotency%ROWTYPE;
  v_actor          uuid := auth.uid();
  v_role           text := current_setting('request.jwt.claim.role', true);
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

  -- D. Overdraft guard (debits cannot drive balance below zero)
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

  -- E. DRY RUN PATH — log only, no mutation of wallets / wallet_transactions
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

  -- F. LIVE PATH — intentionally stubbed in Step A1.
  --    Live mutation is gated to a future explicit step (A1.5+).
  RAISE EXCEPTION
    'wallet_ledger_apply_v2 live mutation is not authorized in Step A1 (shadow-only build). Call with p_dry_run=true.'
    USING ERRCODE = 'P0001';
END;
$$;

-- 5) Lockdown — REVOKE ALL by default. No caller can invoke until granted.
REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)
  IS 'Phase 1A Step A1 shadow-only canonical wallet ledger writer. dry_run=true logs to wallet_ledger_shadow_log + wallet_ledger_audit_log without mutating wallets/wallet_transactions. Live branch is stubbed and RAISES. REVOKE ALL by default.';

COMMENT ON TABLE public.wallet_ledger_idempotency IS 'Phase 1A canonical idempotency registry for wallet_ledger_apply_v2. Populated by live mode only (not yet enabled).';
COMMENT ON TABLE public.wallet_ledger_shadow_log  IS 'Phase 1A shadow log — every dry_run v2 call writes here. Read-only forensic record.';
COMMENT ON TABLE public.wallet_ledger_audit_log   IS 'Phase 1A canonical audit log — every v2 call (success/replay/error) writes here including dry_run flag.';