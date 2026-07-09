
-- =========================================================================
-- Phase-1A Step B: Hourly Wallet Ledger v2 Diff Monitor
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.wallet_ledger_v2_diff_log (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at                            timestamptz NOT NULL DEFAULT now(),
  window_interval                   interval    NOT NULL,
  window_start                      timestamptz,
  window_end                        timestamptz,
  live_wallet_transactions_total    bigint      NOT NULL DEFAULT 0,
  shadow_log_total                  bigint      NOT NULL DEFAULT 0,
  matched                           bigint      NOT NULL DEFAULT 0,
  unmatched_live                    bigint      NOT NULL DEFAULT 0,
  unmatched_shadow                  bigint      NOT NULL DEFAULT 0,
  amount_mismatch                   bigint      NOT NULL DEFAULT 0,
  type_mismatch                     bigint      NOT NULL DEFAULT 0,
  user_mismatch                     bigint      NOT NULL DEFAULT 0,
  reference_mismatch                bigint      NOT NULL DEFAULT 0,
  error_count                       bigint      NOT NULL DEFAULT 0,
  mismatch_count                    bigint      NOT NULL DEFAULT 0,
  latest_mismatch_at                timestamptz,
  safe_for_shadow_wiring            boolean,
  wallets_checksum                  text,
  raw_report                        jsonb,
  alert_fired                       boolean     NOT NULL DEFAULT false,
  notes                             text
);

CREATE INDEX IF NOT EXISTS wallet_ledger_v2_diff_log_ran_at_idx
  ON public.wallet_ledger_v2_diff_log (ran_at DESC);

ALTER TABLE public.wallet_ledger_v2_diff_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_ledger_v2_diff_log admin read" ON public.wallet_ledger_v2_diff_log;
CREATE POLICY "wallet_ledger_v2_diff_log admin read"
  ON public.wallet_ledger_v2_diff_log
  FOR SELECT
  TO authenticated
  USING ( public.has_role(auth.uid(), 'admin'::app_role) );

REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_v2_diff_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval DEFAULT interval '1 hour')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    SELECT t.id AS live_id, t.user_id, t.amount, t.type, t.reference_id, t.created_at
      FROM public.wallet_transactions t WHERE t.created_at >= v_since
  ),
  pairs AS (
    SELECT s.shadow_id, s.user_id AS s_user, s.amount AS s_amount,
           s.op AS s_op, s.captured_at AS s_ts,
           l.live_id, l.user_id AS l_user, l.amount AS l_amount,
           l.type AS l_type, l.reference_id AS l_ref, l.created_at AS l_ts
      FROM s
      LEFT JOIN LATERAL (
        SELECT * FROM l
         WHERE l.user_id = s.user_id AND l.amount = s.amount
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
       v_reference_mismatch, v_latest_mismatch
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

  v_mismatch_count := v_amount_mismatch + v_type_mismatch + v_user_mismatch;
  v_safe := (v_amount_mismatch = 0) AND (v_type_mismatch = 0) AND (v_user_mismatch = 0);

  SELECT md5(string_agg(user_id::text || ':' || balance::text, ',' ORDER BY user_id))
    INTO v_checksum FROM public.wallets;

  v_raw := jsonb_build_object(
    'window_start', v_since, 'window_end', v_now,
    'live_wallet_transactions_total', v_live_total,
    'shadow_log_total', v_shadow_total, 'matched', v_matched,
    'unmatched_live', v_unmatched_live, 'unmatched_shadow', v_unmatched_shadow,
    'amount_mismatch', v_amount_mismatch, 'type_mismatch', v_type_mismatch,
    'user_mismatch', v_user_mismatch, 'reference_mismatch', v_reference_mismatch,
    'error_count', v_error_count, 'mismatch_count', v_mismatch_count,
    'latest_mismatch_at', v_latest_mismatch, 'safe_for_shadow_wiring', v_safe,
    'wallets_checksum', v_checksum,
    'note', 'Step B hourly snapshot (cron, dry-run monitoring only).'
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
$fn$;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_diff_snapshot(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_snapshot(interval) TO postgres, service_role;

DO $cron$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'wallet_ledger_v2_diff_hourly' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END
$cron$;

SELECT cron.schedule(
  'wallet_ledger_v2_diff_hourly',
  '7 * * * *',
  $sql$ SELECT public.wallet_ledger_v2_diff_snapshot('1 hour'::interval); $sql$
);
