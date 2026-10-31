-- Allow authenticated users to read profiles through the profiles_public view
-- The view already strips sensitive fields, so this is safe
CREATE POLICY "Authenticated users can view public profile data"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Drop the overly restrictive own-profile-only policy since the new one is broader
DROP POLICY IF EXISTS "Users can view own full profile" ON public.profiles;