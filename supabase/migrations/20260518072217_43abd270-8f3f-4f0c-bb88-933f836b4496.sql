-- =====================================================================
-- Phase 1A · Step C.fix-3 — Branch-F Option-A + Diff Parity Migration
-- Source of truth: docs/fix-sprints/phase-1a-step-c-fix-2-option-a-diff-parity-patch-plan.md
-- Schema confirmation (pre-patch):
--   wallet_ledger_v2_rows.idempotency_key = text NOT NULL  -> primary 1:1 join used (no fallback shipped)
--   wallet_ledger_v2_rows.balance_after   = numeric NOT NULL
-- Three functions patched. No DDL on tables. No caller diffs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PATCH 1 / 3 — wallet_ledger_apply_v2  (Option A: MIRROR MODE)
-- Only authorised algebraic change is line marked "MIRROR MODE".
-- ---------------------------------------------------------------------
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
  -- MIRROR MODE (Phase 1A · C.fix-3 · Option A):
  -- Legacy wallet_transaction() is the authoritative balance writer. It
  -- commits at T+0; this function runs at T+~234 ms (ordering proven in
  -- docs/fix-sprints/phase-1a-step-c-branch-f-balance-after-audit.md §1.4).
  -- Therefore v_balance_before already reflects the post-legacy authoritative
  -- balance. Do NOT re-apply p_amount here; p_amount is preserved as a
  -- column in wallet_ledger_v2_rows for downstream reconciliation.
  v_balance_after := v_balance_before;

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

-- ---------------------------------------------------------------------
-- PATCH 2 / 3 — wallet_ledger_v2_diff_report  (R2 balance_after parity)
-- Additive: new lateral join + 2 projection cols + 1 counter +
-- safe_for_shadow_wiring AND-includes balance_after_mismatch = 0.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_report(
  p_window interval DEFAULT '24:00:00'::interval
)
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
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role)
             OR public.has_role(auth.uid(), 'super_admin'::app_role);
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
    'note', 'C.fix-3: balance_after parity included in safe verdict.'
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- PATCH 3 / 3 — wallet_ledger_v2_diff_snapshot  (R2 parity, persisted)
-- Mirrors Patch 2 inside the snapshot. R4 alert paging intentionally
-- left unchanged (DEFERRED per authorised gates).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_snapshot(
  p_window interval DEFAULT '01:00:00'::interval
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
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
  v_mismatch_count   bigint := 0;
  -- NEW (C.fix-3 / R2):
  v_balance_after_mismatch bigint := 0;
  v_max_balance_after_delta numeric;
  v_safe             boolean;
  v_checksum         text;
  v_raw              jsonb;
  v_alert            boolean;
  v_log_id           uuid;
  v_hour_key         timestamptz := date_trunc('hour', v_now);
  v_existing_alert   uuid;
BEGIN
  SELECT count(*) INTO v_live_total
    FROM public.wallet_transactions WHERE created_at >= v_since;

  SELECT count(*) INTO v_shadow_total
    FROM public.wallet_ledger_shadow_log WHERE captured_at >= v_since;

  SELECT count(*) INTO v_error_count
    FROM public.wallet_ledger_audit_log
   WHERE captured_at >= v_since AND result = 'error';

  WITH s AS (
    SELECT s.id AS shadow_id, s.intended_user_id AS user_id,
           s.intended_amount AS amount, s.op, s.idempotency_key, s.captured_at
      FROM public.wallet_ledger_shadow_log s
     WHERE s.captured_at >= v_since AND s.validation_ok = true
  ),
  l AS (
    SELECT t.id AS live_id, t.user_id, t.amount, t.type,
           t.reference_id, t.balance_after, t.created_at
      FROM public.wallet_transactions t WHERE t.created_at >= v_since
  ),
  pairs AS (
    SELECT s.shadow_id, s.user_id AS s_user, s.amount AS s_amount,
           s.op AS s_op, s.captured_at AS s_ts, s.idempotency_key AS s_idem,
           l.live_id, l.user_id AS l_user, l.amount AS l_amount,
           l.type AS l_type, l.reference_id AS l_ref,
           l.balance_after AS l_balance_after,
           l.created_at AS l_ts,
           v2.v2_balance_after AS v2_balance_after
      FROM s
      LEFT JOIN LATERAL (
        SELECT * FROM l
         WHERE l.user_id = s.user_id AND l.amount = s.amount
         ORDER BY abs(extract(epoch FROM (l.created_at - s.captured_at)))
         LIMIT 1
      ) l ON true
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
     AND NOT EXISTS (SELECT 1 FROM s WHERE s.user_id = t.user_id AND s.amount = t.amount);

  -- mismatch_count now includes balance_after_mismatch so verdict + persisted
  -- counter both reflect R2 drift.
  v_mismatch_count := v_amount_mismatch + v_type_mismatch + v_user_mismatch
                    + v_balance_after_mismatch;
  v_safe := (v_amount_mismatch = 0)
        AND (v_type_mismatch   = 0)
        AND (v_user_mismatch   = 0)
        AND (v_balance_after_mismatch = 0);

  SELECT md5(string_agg(user_id::text || ':' || balance::text, ',' ORDER BY user_id))
    INTO v_checksum FROM public.wallets;

  v_raw := jsonb_build_object(
    'window_start', v_since, 'window_end', v_now,
    'live_wallet_transactions_total', v_live_total,
    'shadow_log_total', v_shadow_total, 'matched', v_matched,
    'unmatched_live', v_unmatched_live, 'unmatched_shadow', v_unmatched_shadow,
    'amount_mismatch', v_amount_mismatch, 'type_mismatch', v_type_mismatch,
    'user_mismatch', v_user_mismatch, 'reference_mismatch', v_reference_mismatch,
    'balance_after_mismatch', v_balance_after_mismatch,
    'max_balance_after_delta', v_max_balance_after_delta,
    'error_count', v_error_count, 'mismatch_count', v_mismatch_count,
    'latest_mismatch_at', v_latest_mismatch, 'safe_for_shadow_wiring', v_safe,
    'wallets_checksum', v_checksum,
    'note', 'C.fix-3 snapshot: balance_after parity gates safe_for_shadow_wiring.'
  );

  v_alert := (v_mismatch_count > 0)
          OR (v_error_count    > 0)
          OR (v_unmatched_live > 0)
          OR (v_unmatched_shadow > 0);

  INSERT INTO public.wallet_ledger_v2_diff_log (
    window_interval, window_start, window_end,
    live_wallet_transactions_total, shadow_log_total,
    matched, unmatched_live, unmatched_shadow,
    amount_mismatch, type_mismatch, user_mismatch, reference_mismatch,
    error_count, mismatch_count, latest_mismatch_at, safe_for_shadow_wiring,
    wallets_checksum, raw_report, alert_fired
  ) VALUES (
    p_window, v_since, v_now,
    v_live_total, v_shadow_total,
    v_matched, v_unmatched_live, v_unmatched_shadow,
    v_amount_mismatch, v_type_mismatch, v_user_mismatch, v_reference_mismatch,
    v_error_count, v_mismatch_count, v_latest_mismatch, v_safe,
    v_checksum, v_raw, v_alert
  )
  RETURNING id INTO v_log_id;

  IF v_alert THEN
    SELECT id INTO v_existing_alert
      FROM public.admin_notifications
     WHERE type = 'wallet_ledger_v2_diff_drift'
       AND created_at >= v_hour_key
     LIMIT 1;

    IF v_existing_alert IS NULL THEN
      INSERT INTO public.admin_notifications (type, title, message, reference_id)
      VALUES (
        'wallet_ledger_v2_diff_drift',
        'Wallet ledger v2 diff drift detected',
        format(
          'Hourly diff snapshot flagged drift: mismatch=%s, errors=%s, unmatched_live=%s, unmatched_shadow=%s. Inspect /admin/health.',
          v_mismatch_count, v_error_count, v_unmatched_live, v_unmatched_shadow
        ),
        v_log_id
      );
    END IF;
  END IF;

  RETURN v_log_id;
END;
$function$;