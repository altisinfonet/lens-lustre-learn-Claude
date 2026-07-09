-- Test Agent infrastructure: read-only health RPC + run log table
-- Uses 'admin' role (project's enum has no super_admin)

CREATE TABLE IF NOT EXISTS public.test_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('push','pull_request','schedule','workflow_dispatch','manual')),
  commit_sha TEXT,
  branch TEXT,
  status TEXT NOT NULL CHECK (status IN ('passed','failed','partial')),
  rpc_parity_pass BOOLEAN,
  nr_drift_5min INTEGER,
  dual_emit_status TEXT,
  tsc_pass BOOLEAN,
  vitest_pass BOOLEAN,
  eslint_pass BOOLEAN,
  failures JSONB DEFAULT '[]'::jsonb,
  duration_ms INTEGER,
  report_url TEXT,
  github_run_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_agent_runs_created_at ON public.test_agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_agent_runs_status ON public.test_agent_runs (status, created_at DESC);

ALTER TABLE public.test_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_test_agent_runs"
ON public.test_agent_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Health snapshot RPC — anon-callable, read-only, returns ONE row
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

  SELECT p.email INTO v_admin_email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id
  WHERE ur.role = 'admin'::app_role
    AND p.email IS NOT NULL
  ORDER BY p.email
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

REVOKE ALL ON FUNCTION public.get_test_agent_health_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_test_agent_health_admin() TO anon, authenticated, service_role;

-- Insert RPC — protected by shared secret token from vault
CREATE OR REPLACE FUNCTION public.record_test_agent_run(
  p_token TEXT,
  p_run_id TEXT,
  p_trigger TEXT,
  p_commit_sha TEXT,
  p_branch TEXT,
  p_status TEXT,
  p_rpc_parity_pass BOOLEAN,
  p_nr_drift_5min INTEGER,
  p_dual_emit_status TEXT,
  p_tsc_pass BOOLEAN,
  p_vitest_pass BOOLEAN,
  p_eslint_pass BOOLEAN,
  p_failures JSONB,
  p_duration_ms INTEGER,
  p_github_run_url TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token TEXT;
  v_id UUID;
BEGIN
  SELECT decrypted_secret INTO v_expected_token
  FROM vault.decrypted_secrets
  WHERE name = 'test_agent_ingest_token'
  LIMIT 1;

  IF v_expected_token IS NULL OR p_token IS NULL OR p_token <> v_expected_token THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  INSERT INTO public.test_agent_runs (
    run_id, trigger, commit_sha, branch, status,
    rpc_parity_pass, nr_drift_5min, dual_emit_status,
    tsc_pass, vitest_pass, eslint_pass,
    failures, duration_ms, github_run_url
  ) VALUES (
    p_run_id, p_trigger, p_commit_sha, p_branch, p_status,
    p_rpc_parity_pass, p_nr_drift_5min, p_dual_emit_status,
    p_tsc_pass, p_vitest_pass, p_eslint_pass,
    COALESCE(p_failures, '[]'::jsonb), p_duration_ms, p_github_run_url
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_test_agent_run(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,JSONB,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_test_agent_run(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,JSONB,INTEGER,TEXT) TO anon, authenticated;

-- Generate + store ingest token in vault (idempotent)
DO $$
DECLARE
  v_existing TEXT;
  v_new_token TEXT;
BEGIN
  SELECT decrypted_secret INTO v_existing
  FROM vault.decrypted_secrets
  WHERE name = 'test_agent_ingest_token' LIMIT 1;

  IF v_existing IS NULL THEN
    v_new_token := encode(gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(v_new_token, 'test_agent_ingest_token', 'Shared secret for record_test_agent_run RPC');
  END IF;
END $$;