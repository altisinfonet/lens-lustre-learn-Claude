CREATE OR REPLACE FUNCTION public.get_test_agent_health_admin()
RETURNS TABLE (
  rpc_parity_pass BOOLEAN,
  rpc_parity_sample_size INTEGER,
  rpc_parity_mismatch_count INTEGER,
  nr_drift_5min INTEGER,
  nr_drift_24h INTEGER,
  dual_emit_status TEXT,
  super_admin_email TEXT,
  checked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample UUID[];
  v_mismatch_count INTEGER := 0;
  v_sample_size INTEGER := 0;
  v_admin_email TEXT;
  v_dual_emit TEXT := 'unknown';
BEGIN
  SELECT array_agg(id) INTO v_sample
  FROM (
    SELECT id FROM public.competition_entries
    WHERE status IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 50
  ) s;

  IF v_sample IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sample_size
    FROM public.get_per_photo_consensus(v_sample);

    SELECT COUNT(*) INTO v_mismatch_count
    FROM public.get_per_photo_consensus(v_sample)
    WHERE status IS NULL OR status_legacy IS NULL;

    v_dual_emit := CASE
      WHEN v_sample_size = 0 THEN 'no_data'
      WHEN v_mismatch_count = 0 THEN 'healthy'
      ELSE 'drift_detected'
    END;
  END IF;

  SELECT u.email::text INTO v_admin_email
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.role::text = 'admin'
    AND u.email IS NOT NULL
  ORDER BY u.email
  LIMIT 1;

  RETURN QUERY SELECT
    (v_mismatch_count = 0 AND v_sample_size > 0) AS rpc_parity_pass,
    v_sample_size,
    v_mismatch_count,
    (SELECT COUNT(*)::INTEGER FROM public.db_audit_logs
     WHERE operation = 'NR_DRIFT_R2_PLUS'
       AND created_at > now() - interval '5 minutes'),
    (SELECT COUNT(*)::INTEGER FROM public.db_audit_logs
     WHERE operation = 'NR_DRIFT_R2_PLUS'
       AND created_at > now() - interval '24 hours'),
    v_dual_emit,
    v_admin_email,
    now();
END;
$$;