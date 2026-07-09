-- CRITICAL FIX: Add 'payment_gateways' to the excluded keys in RLS policy
DROP POLICY IF EXISTS "Public can read non-sensitive settings" ON public.site_settings;
CREATE POLICY "Public can read non-sensitive settings"
ON public.site_settings
FOR SELECT
TO authenticated, anon
USING (key <> ALL (ARRAY['s3_storage_settings', 'smtp_settings', 'whatsapp_settings', 'payment_gateways']));