-- Test Agent admin controls: config table + bulk-delete policy

CREATE TABLE IF NOT EXISTS public.test_agent_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true), -- singleton
  enabled boolean NOT NULL DEFAULT true,
  interval_minutes integer NOT NULL DEFAULT 5 CHECK (interval_minutes IN (5, 15, 30, 60)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.test_agent_config (id, enabled, interval_minutes)
VALUES (true, true, 5)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.test_agent_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read test agent config" ON public.test_agent_config;
CREATE POLICY "Anyone can read test agent config"
  ON public.test_agent_config FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can update test agent config" ON public.test_agent_config;
CREATE POLICY "Admins can update test agent config"
  ON public.test_agent_config FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Allow admins to bulk delete test_agent_runs logs
DROP POLICY IF EXISTS "Admins can delete test agent runs" ON public.test_agent_runs;
CREATE POLICY "Admins can delete test agent runs"
  ON public.test_agent_runs FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Public RPC for the GitHub Actions runner to consult before doing work
-- Returns whether a run should proceed based on enabled flag + interval + last run time.
CREATE OR REPLACE FUNCTION public.should_test_agent_run(p_trigger text DEFAULT 'schedule')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.test_agent_config%ROWTYPE;
  last_run timestamptz;
  minutes_since numeric;
BEGIN
  SELECT * INTO cfg FROM public.test_agent_config WHERE id = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('should_run', true, 'reason', 'no_config');
  END IF;

  -- Push / PR / manual always run when enabled
  IF p_trigger IN ('push','pull_request','workflow_dispatch') THEN
    RETURN jsonb_build_object(
      'should_run', cfg.enabled,
      'reason', CASE WHEN cfg.enabled THEN 'enabled_event' ELSE 'disabled' END,
      'enabled', cfg.enabled,
      'interval_minutes', cfg.interval_minutes
    );
  END IF;

  IF NOT cfg.enabled THEN
    RETURN jsonb_build_object('should_run', false, 'reason', 'disabled', 'enabled', false, 'interval_minutes', cfg.interval_minutes);
  END IF;

  SELECT MAX(created_at) INTO last_run FROM public.test_agent_runs;
  IF last_run IS NULL THEN
    RETURN jsonb_build_object('should_run', true, 'reason', 'no_prior_run', 'enabled', true, 'interval_minutes', cfg.interval_minutes);
  END IF;

  minutes_since := EXTRACT(EPOCH FROM (now() - last_run)) / 60.0;
  IF minutes_since >= cfg.interval_minutes THEN
    RETURN jsonb_build_object(
      'should_run', true, 'reason', 'interval_elapsed',
      'minutes_since_last', minutes_since,
      'enabled', true, 'interval_minutes', cfg.interval_minutes
    );
  ELSE
    RETURN jsonb_build_object(
      'should_run', false, 'reason', 'interval_not_elapsed',
      'minutes_since_last', minutes_since,
      'enabled', true, 'interval_minutes', cfg.interval_minutes
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.should_test_agent_run(text) TO anon, authenticated;