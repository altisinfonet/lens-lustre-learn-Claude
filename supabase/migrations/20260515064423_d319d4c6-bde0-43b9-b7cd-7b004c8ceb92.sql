-- Phase 1A Step A1.6 — read-only drift report RPC (additive, no mutation)
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_drift_report(
  p_window interval DEFAULT interval '24 hours'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_since timestamptz := now() - p_window;
  v_audit_total bigint;
  v_audit_dry_ok bigint;
  v_audit_replay bigint;
  v_audit_error bigint;
  v_audit_live_ok bigint;
  v_shadow_total bigint;
  v_shadow_valid bigint;
  v_shadow_invalid bigint;
  v_idem_total bigint;
  v_error_breakdown jsonb;
BEGIN
  -- Admin-only gate (no anon/authenticated leakage)
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role)
             OR public.has_role(auth.uid(), 'super_admin'::app_role);
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE result = 'dry_run_ok'),
         count(*) FILTER (WHERE result = 'replay'),
         count(*) FILTER (WHERE result = 'error'),
         count(*) FILTER (WHERE result = 'live_ok')
  INTO v_audit_total, v_audit_dry_ok, v_audit_replay, v_audit_error, v_audit_live_ok
  FROM public.wallet_ledger_audit_log
  WHERE captured_at >= v_since;

  SELECT count(*),
         count(*) FILTER (WHERE validation_ok = true),
         count(*) FILTER (WHERE validation_ok = false)
  INTO v_shadow_total, v_shadow_valid, v_shadow_invalid
  FROM public.wallet_ledger_shadow_log
  WHERE captured_at >= v_since;

  SELECT count(*) INTO v_idem_total
  FROM public.wallet_ledger_idempotency
  WHERE created_at >= v_since;

  SELECT COALESCE(jsonb_object_agg(error_code, c), '{}'::jsonb)
  INTO v_error_breakdown
  FROM (
    SELECT error_code, count(*) AS c
    FROM public.wallet_ledger_audit_log
    WHERE captured_at >= v_since AND result = 'error' AND error_code IS NOT NULL
    GROUP BY error_code
  ) e;

  RETURN jsonb_build_object(
    'window_start', v_since,
    'window_end',   now(),
    'audit', jsonb_build_object(
      'total',       v_audit_total,
      'dry_run_ok',  v_audit_dry_ok,
      'replay',      v_audit_replay,
      'error',       v_audit_error,
      'live_ok',     v_audit_live_ok
    ),
    'shadow', jsonb_build_object(
      'total',   v_shadow_total,
      'valid',   v_shadow_valid,
      'invalid', v_shadow_invalid
    ),
    'idempotency', jsonb_build_object(
      'rows_in_window', v_idem_total
    ),
    'error_breakdown', v_error_breakdown,
    'note', 'read-only; no wallet mutation; A1.6 scope'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_drift_report(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_drift_report(interval) TO authenticated;
-- Note: function self-checks admin role; granting to authenticated is safe because
-- non-admin callers are rejected with 42501 inside the function body.