-- Fix site_settings: restrict sensitive keys from public
DROP POLICY IF EXISTS "Anyone can read settings" ON public.site_settings;

CREATE POLICY "Public can read non-sensitive settings" ON public.site_settings
  FOR SELECT TO public
  USING (key NOT IN ('s3_storage_settings', 'smtp_settings', 'whatsapp_settings'));

CREATE POLICY "Admins can read all settings" ON public.site_settings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix profiles: restrict SELECT to own row + admin (remove public exposure)
DROP POLICY IF EXISTS "Anyone can view public profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view public profile data" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());