
REVOKE SELECT (exif_data, ai_detection_result) ON public.competition_entries FROM anon;

DROP POLICY IF EXISTS "Anyone can read test agent config" ON public.test_agent_config;
CREATE POLICY "Admins can read test agent config"
  ON public.test_agent_config
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated can view admin roles" ON public.user_roles;
