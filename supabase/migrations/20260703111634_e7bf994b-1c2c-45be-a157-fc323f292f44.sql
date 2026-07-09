-- 1) ai_settings_rls_gap — extend the public-readable blocklist to hide ai_model_settings
DROP POLICY IF EXISTS "Public can read non-sensitive settings" ON public.site_settings;
CREATE POLICY "Public can read non-sensitive settings"
  ON public.site_settings
  FOR SELECT
  TO anon, authenticated
  USING (
    key <> ALL (ARRAY[
      's3_storage_settings',
      'smtp_settings',
      'whatsapp_settings',
      'payment_gateways',
      'ai_model_settings'
    ])
  );

-- 2) profiles_no_public_select_policy — strip behavioural + moderation flags from anon
REVOKE SELECT (last_active_at, is_banned, is_suspended)
  ON public.profiles_public_data
  FROM anon;

-- 3) newsletter_subscribers_no_self_read — self-manage policies (owner scoped by user_id)
DROP POLICY IF EXISTS "Users read own subscription" ON public.newsletter_subscribers;
CREATE POLICY "Users read own subscription"
  ON public.newsletter_subscribers
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own subscription" ON public.newsletter_subscribers;
CREATE POLICY "Users update own subscription"
  ON public.newsletter_subscribers
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own subscription" ON public.newsletter_subscribers;
CREATE POLICY "Users delete own subscription"
  ON public.newsletter_subscribers
  FOR DELETE
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());