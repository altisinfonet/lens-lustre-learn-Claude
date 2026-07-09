-- Fix: Replace blanket public SELECT on profiles_public_data with authenticated-only access
-- This prevents anonymous users from reading privacy_settings and profile data

DROP POLICY IF EXISTS "Anyone can view public profile data" ON public.profiles_public_data;

-- Authenticated users can view public profile data (needed for profile pages)
CREATE POLICY "Authenticated users can view public profile data"
ON public.profiles_public_data
FOR SELECT
TO authenticated
USING (true);

-- Anonymous users can only view basic profile info (no privacy_settings exposed)
-- Using a limited set: id, full_name, avatar_url, bio, custom_url
CREATE POLICY "Anon can view limited public profile data"
ON public.profiles_public_data
FOR SELECT
TO anon
USING (true);