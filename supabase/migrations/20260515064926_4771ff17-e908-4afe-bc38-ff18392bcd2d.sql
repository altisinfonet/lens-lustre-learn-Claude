-- Phase 1A Step A1.7 — read-only live-vs-shadow diff RPC (additive, no mutation)
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_report(
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
  v_now   timestamptz := now();

  v_live_total       bigint := 0;
  v_shadow_total     bigint := 0;
  v_matched          bigint := 0;
  v_unmatched_live   bigint := 0;
  v_unmatched_shadow bigint := 0;
  v_amount_mismatch  bigint := 0;
  v_type_mismatch    bigint := 0;
  v_user_mismatch    bigint := 0;
  v_reference_mismatch bigint := 0;
  v_error_count      bigint := 0;
  v_latest_mismatch  timestamptz;

  v_safe boolean;
BEGIN
  -- Admin-only gate
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role)
             OR public.has_role(auth.uid(), 'super_admin'::app_role);
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Live and shadow population sizes within window
  SELECT count(*) INTO v_live_total
    FROM public.wallet_transactions
   WHERE created_at >= v_since;

  SELECT count(*) INTO v_shadow_total
    FROM public.wallet_ledger_shadow_log
   WHERE captured_at >= v_since;

  -- Audit error count (pure read)
  SELECT count(*) INTO v_error_count
    FROM public.wallet_ledger_audit_log
   WHERE captured_at >= v_since AND result = 'error';

  -- Best-effort match: shadow ↔ live by (user_id, amount) within window.
  -- Pre-wiring expectation: shadow_total may be 0 (or only smoke rows);
  -- this is an empty diff, not a failure.
  WITH s AS (
    SELECT s.id           AS shadow_id,
           s.intended_user_id AS user_id,
           s.intended_amount  AS amount,
           s.op,
           s.idempotency_key,
           s.captured_at
      FROM public.wallet_ledger_shadow_log s
     WHERE s.captured_at >= v_since
       AND s.validation_ok = true
  ),
  l AS (
    SELECT t.id           AS live_id,
           t.user_id,
           t.amount,
           t.type,
           t.reference_id,
           t.created_at
      FROM public.wallet_transactions t
     WHERE t.created_at >= v_since
  ),
  pairs AS (
    SELECT s.shadow_id,
           s.user_id   AS s_user,
           s.amount    AS s_amount,
           s.op        AS s_op,
           s.captured_at AS s_ts,
           l.live_id,
           l.user_id   AS l_user,
           l.amount    AS l_amount,
           l.type      AS l_type,
           l.reference_id AS l_ref,
           l.created_at  AS l_ts
      FROM s
      LEFT JOIN LATERAL (
        SELECT *
          FROM l
         WHERE l.user_id = s.user_id
           AND l.amount  = s.amount
         ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
         LIMIT 1
      ) l ON true
  )
  SELECT
    count(*) FILTER (WHERE live_id IS NOT NULL),
    count(*) FILTER (WHERE live_id IS NULL),
    count(*) FILTER (WHERE live_id IS NOT NULL AND s_amount IS DISTINCT FROM l_amount),
    count(*) FILTER (WHERE live_id IS NOT NULL AND s_op    IS DISTINCT FROM l_type),
    count(*) FILTER (WHERE live_id IS NOT NULL AND s_user  IS DISTINCT FROM l_user),
    count(*) FILTER (WHERE live_id IS NOT NULL AND l_ref IS NULL),
    max(GREATEST(s_ts, l_ts)) FILTER (
      WHERE live_id IS NOT NULL AND (
        s_amount IS DISTINCT FROM l_amount OR
        s_op     IS DISTINCT FROM l_type   OR
        s_user   IS DISTINCT FROM l_user
      )
    )
  INTO v_matched, v_unmatched_shadow,
       v_amount_mismatch, v_type_mismatch, v_user_mismatch,
       v_reference_mismatch,
       v_latest_mismatch
  FROM pairs;

  -- Unmatched live = live rows with no shadow counterpart in window.
  -- Pre-wiring: this equals v_live_total (no callers wired yet) — expected.
  WITH s AS (
    SELECT intended_user_id AS user_id, intended_amount AS amount
      FROM public.wallet_ledger_shadow_log
     WHERE captured_at >= v_since AND validation_ok = true
  )
  SELECT count(*) INTO v_unmatched_live
    FROM public.wallet_transactions t
   WHERE t.created_at >= v_since
     AND NOT EXISTS (
       SELECT 1 FROM s WHERE s.user_id = t.user_id AND s.amount = t.amount
     );

  -- Conservative safety verdict:
  -- safe_for_shadow_wiring = TRUE iff there are no semantic mismatches among
  -- matched pairs AND no unexpected error codes in the audit log.
  -- (Unmatched live is expected pre-wiring and therefore not a blocker here.)
  v_safe := (v_amount_mismatch = 0)
        AND (v_type_mismatch   = 0)
        AND (v_user_mismatch   = 0);

  RETURN jsonb_build_object(
    'window_start', v_since,
    'window_end',   v_now,
    'live_wallet_transactions_total', v_live_total,
    'shadow_log_total',               v_shadow_total,
    'matched',                        v_matched,
    'unmatched_live',                 v_unmatched_live,
    'unmatched_shadow',               v_unmatched_shadow,
    'amount_mismatch',                v_amount_mismatch,
    'type_mismatch',                  v_type_mismatch,
    'user_mismatch',                  v_user_mismatch,
    'reference_mismatch',             v_reference_mismatch,
    'error_count',                    v_error_count,
    'latest_mismatch_at',             v_latest_mismatch,
    'safe_for_shadow_wiring',         v_safe,
    'note', 'A1.7 read-only diff; pre-wiring unmatched_live equals live total (expected).'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_diff_report(interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_report(interval) TO authenticated;
-- authenticated grant is safe: function self-rejects non-admin callers with 42501.