-- =============================================================================
-- PHASE 4 — Notification Backfill & Drift Audit
-- =============================================================================

-- Status → (kind, template_name, in_app_type, in_app_title, in_app_message)
-- Mirrors the trigger logic in 20260424093600_*.sql lines 147-216.
CREATE OR REPLACE FUNCTION public._notification_template_for_entry(
  _status text,
  _placement text
)
RETURNS TABLE (kind text, email_template text, in_app_type text, in_app_title text, in_app_message text)
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN _placement IN ('winner','1st_runner_up','2nd_runner_up','special_jury','runner_up','honorable_mention') THEN 'entry_award'
      WHEN _status IN ('winner','runner_up','honorable_mention') THEN 'entry_award'
      WHEN _status = 'finalist' THEN 'entry_finalist'
      WHEN _status ILIKE 'round%qualified' OR _status = 'qualified' THEN 'entry_qualified_round'
      WHEN _status ILIKE '%shortlist%' THEN 'entry_shortlisted'
      WHEN _status = 'rejected' THEN 'entry_rejected'
      WHEN _status = 'approved' THEN 'entry_approved'
      ELSE NULL
    END,
    CASE
      WHEN _placement IN ('winner','1st_runner_up','2nd_runner_up','special_jury','runner_up','honorable_mention') THEN 'competition_winner'
      WHEN _status IN ('winner','runner_up','honorable_mention') THEN 'competition_winner'
      WHEN _status = 'finalist' THEN 'entry_finalist'
      WHEN _status ILIKE 'round%qualified' OR _status = 'qualified' THEN 'entry_qualified'
      WHEN _status ILIKE '%shortlist%' THEN 'entry_shortlisted'
      WHEN _status = 'rejected' THEN 'entry_rejected'
      WHEN _status = 'approved' THEN 'entry_approved'
      ELSE NULL
    END,
    CASE
      WHEN _placement IN ('winner','1st_runner_up','2nd_runner_up','special_jury','runner_up','honorable_mention') THEN 'award'
      WHEN _status IN ('winner','runner_up','honorable_mention') THEN 'award'
      WHEN _status = 'finalist' THEN 'finalist'
      WHEN _status ILIKE 'round%qualified' OR _status = 'qualified' THEN 'qualified'
      WHEN _status ILIKE '%shortlist%' THEN 'shortlisted'
      WHEN _status = 'rejected' THEN 'rejected'
      WHEN _status = 'approved' THEN 'approved'
      ELSE NULL
    END,
    CASE
      WHEN _placement IN ('winner','1st_runner_up','2nd_runner_up','special_jury','runner_up','honorable_mention') THEN 'Congratulations on your award!'
      WHEN _status IN ('winner','runner_up','honorable_mention') THEN 'Congratulations on your award!'
      WHEN _status = 'finalist' THEN 'You are a finalist!'
      WHEN _status ILIKE 'round%qualified' OR _status = 'qualified' THEN 'You advanced to the next round'
      WHEN _status ILIKE '%shortlist%' THEN 'Your entry was shortlisted'
      WHEN _status = 'rejected' THEN 'Update on your entry'
      WHEN _status = 'approved' THEN 'Entry Approved'
      ELSE NULL
    END,
    'See your entry status in the dashboard.';
$$;

-- ─── Drift audit RPC ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_notification_drift_admin(_window_days int DEFAULT 90)
RETURNS TABLE (
  expected_template text,
  total_entries bigint,
  missing_emit bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT
      ce.id AS entry_id,
      ce.user_id AS recipient_user_id,
      (SELECT t.email_template FROM public._notification_template_for_entry(ce.status, ce.placement) t) AS expected_template
    FROM competition_entries ce
    WHERE ce.updated_at > now() - make_interval(days => _window_days)
  )
  SELECT
    t.expected_template,
    count(*)::bigint AS total_entries,
    count(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM notification_emit_log nel
        WHERE nel.entity_id = t.entry_id
          AND nel.email_template = t.expected_template
          AND nel.recipient_user_id = t.recipient_user_id
      )
    )::bigint AS missing_emit
  FROM targets t
  WHERE t.expected_template IS NOT NULL
  GROUP BY t.expected_template
  ORDER BY 3 DESC;
END;
$$;

-- ─── Stuck verifications RPC ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stuck_verifications_admin()
RETURNS TABLE (
  stuck_pending_24h bigint,
  stuck_no_email bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE pvr.status = 'pending' AND pvr.created_at < now() - interval '24 hours')::bigint,
    count(*) FILTER (
      WHERE pvr.status = 'pending'
        AND pvr.created_at < now() - interval '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notification_emit_log nel
          WHERE nel.entity_id = pvr.id
            AND nel.kind = 'verification_request_created'
        )
    )::bigint
  FROM photo_verification_requests pvr;
END;
$$;

-- ─── Notification health stats ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_notification_health_stats_admin()
RETURNS TABLE (
  emits_today bigint,
  emits_total bigint,
  distinct_templates bigint,
  failures_today bigint,
  dlq_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM notification_emit_log WHERE created_at::date = current_date)::bigint,
    (SELECT count(*) FROM notification_emit_log)::bigint,
    (SELECT count(DISTINCT email_template) FROM notification_emit_log WHERE email_template IS NOT NULL)::bigint,
    (SELECT count(DISTINCT message_id) FROM email_send_log
      WHERE created_at::date = current_date
        AND status IN ('failed','dlq','bounced'))::bigint,
    (SELECT count(DISTINCT message_id) FROM email_send_log WHERE status = 'dlq')::bigint;
END;
$$;

-- ─── Idempotent backfill: missed judging-status notifications ────────────────
CREATE OR REPLACE FUNCTION public.backfill_judging_notifications(
  _window_days int DEFAULT 90,
  _dry_run boolean DEFAULT true
)
RETURNS TABLE (
  scanned bigint,
  would_emit bigint,
  emitted bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scanned bigint := 0;
  _candidates bigint := 0;
  _emitted bigint := 0;
  _row record;
  _tmpl record;
  _site_url text := 'https://fiftymmretinaworld.lovable.app';
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  FOR _row IN
    SELECT ce.id, ce.user_id, ce.competition_id, ce.status, ce.placement, ce.current_round, ce.title
    FROM competition_entries ce
    WHERE ce.updated_at > now() - make_interval(days => _window_days)
  LOOP
    _scanned := _scanned + 1;
    SELECT * INTO _tmpl FROM public._notification_template_for_entry(_row.status, _row.placement);
    CONTINUE WHEN _tmpl.email_template IS NULL;

    -- Skip if already emitted (idempotency)
    IF EXISTS (
      SELECT 1 FROM notification_emit_log
      WHERE entity_id = _row.id
        AND email_template = _tmpl.email_template
        AND recipient_user_id = _row.user_id
    ) THEN
      CONTINUE;
    END IF;

    _candidates := _candidates + 1;

    IF NOT _dry_run THEN
      PERFORM public.emit_notification(
        _tmpl.kind,
        _row.id,
        NULLIF(regexp_replace(COALESCE(_row.current_round,''), '\D','','g'),'')::int,
        _row.user_id,
        _tmpl.in_app_type,
        _tmpl.in_app_title,
        _tmpl.in_app_message,
        _row.competition_id,
        _tmpl.email_template,
        jsonb_build_object('entryTitle', _row.title, 'backfilled', true),
        _site_url || '/dashboard?entry=' || _row.id::text
      );
      _emitted := _emitted + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT _scanned, _candidates, _emitted;
END;
$$;

-- ─── Idempotent backfill: stuck verification requests ────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_stuck_verifications(
  _dry_run boolean DEFAULT true
)
RETURNS TABLE (
  scanned bigint,
  would_emit bigint,
  emitted bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scanned bigint := 0;
  _candidates bigint := 0;
  _emitted bigint := 0;
  _row record;
  _site_url text := 'https://fiftymmretinaworld.lovable.app';
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  FOR _row IN
    SELECT pvr.*
    FROM photo_verification_requests pvr
    WHERE pvr.status = 'pending'
      AND pvr.created_at < now() - interval '24 hours'
  LOOP
    _scanned := _scanned + 1;

    IF EXISTS (
      SELECT 1 FROM notification_emit_log
      WHERE entity_id = _row.id
        AND kind = 'verification_request_created'
    ) THEN
      CONTINUE;
    END IF;

    _candidates := _candidates + 1;

    IF NOT _dry_run THEN
      PERFORM public.emit_notification(
        'verification_request_created',
        _row.id,
        _row.round_number,
        _row.participant_id,
        'verification_required',
        'Verification needed for your photo',
        'Please upload the original file before the deadline.',
        _row.entry_id,
        'verification_required',
        jsonb_build_object('backfilled', true, 'requestId', _row.id),
        _site_url || '/verify/' || _row.id::text
      );
      _emitted := _emitted + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT _scanned, _candidates, _emitted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notification_drift_admin(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stuck_verifications_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_health_stats_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_judging_notifications(int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_stuck_verifications(boolean) TO authenticated;