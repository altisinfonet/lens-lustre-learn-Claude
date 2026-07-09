CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_report(p_window interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- NEW (C.fix-3 / R2):
  v_balance_after_mismatch bigint := 0;
  v_max_balance_after_delta numeric;

  v_safe boolean;
BEGIN
  -- C.fix-5d: super_admin clause removed — role does not exist in app_role enum.
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_live_total
    FROM public.wallet_transactions WHERE created_at >= v_since;

  SELECT count(*) INTO v_shadow_total
    FROM public.wallet_ledger_shadow_log WHERE captured_at >= v_since;

  SELECT count(*) INTO v_error_count
    FROM public.wallet_ledger_audit_log
   WHERE captured_at >= v_since AND result = 'error';

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
           t.balance_after,
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
           s.idempotency_key AS s_idem,
           l.live_id,
           l.user_id   AS l_user,
           l.amount    AS l_amount,
           l.type      AS l_type,
           l.reference_id AS l_ref,
           l.balance_after AS l_balance_after,
           l.created_at  AS l_ts,
           v2.v2_balance_after AS v2_balance_after
      FROM s
      LEFT JOIN LATERAL (
        SELECT *
          FROM l
         WHERE l.user_id = s.user_id
           AND l.amount  = s.amount
         ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
         LIMIT 1
      ) l ON true
      -- NEW (C.fix-3 / R2): primary 1:1 join on idempotency_key (NOT NULL).
      LEFT JOIN LATERAL (
        SELECT v.balance_after AS v2_balance_after
          FROM public.wallet_ledger_v2_rows v
         WHERE v.idempotency_key = s.idempotency_key
         LIMIT 1
      ) v2 ON true
  )
  SELECT
    count(*) FILTER (WHERE live_id IS NOT NULL),
    count(*) FILTER (WHERE live_id IS NULL),
    count(*) FILTER (WHERE live_id IS NOT NULL AND s_amount IS DISTINCT FROM l_amount),
    count(*) FILTER (WHERE live_id IS NOT NULL AND s_op    IS DISTINCT FROM l_type),
    count(*) FILTER (WHERE live_id IS NOT NULL AND s_user  IS DISTINCT FROM l_user),
    count(*) FILTER (WHERE live_id IS NOT NULL AND l_ref IS NULL),
    -- NEW (C.fix-3 / R2):
    count(*) FILTER (
      WHERE live_id IS NOT NULL
        AND v2_balance_after IS NOT NULL
        AND v2_balance_after IS DISTINCT FROM l_balance_after
    ),
    max(abs(v2_balance_after - l_balance_after)) FILTER (
      WHERE live_id IS NOT NULL AND v2_balance_after IS NOT NULL
    ),
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
       v_balance_after_mismatch,
       v_max_balance_after_delta,
       v_latest_mismatch
  FROM pairs;

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

  -- safe_for_shadow_wiring now AND-includes balance_after_mismatch = 0 (R2 gate).
  v_safe := (v_amount_mismatch = 0)
        AND (v_type_mismatch   = 0)
        AND (v_user_mismatch   = 0)
        AND (v_balance_after_mismatch = 0);

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
    'balance_after_mismatch',         v_balance_after_mismatch,
    'max_balance_after_delta',        v_max_balance_after_delta,
    'error_count',                    v_error_count,
    'latest_mismatch_at',             v_latest_mismatch,
    'safe_for_shadow_wiring',         v_safe,
    'note', 'C.fix-3: balance_after parity included in safe verdict. C.fix-5d: super_admin gate clause removed.'
  );
END;
$function$;