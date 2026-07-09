-- Drop the restrictive policy and recreate as permissive
DROP POLICY "Users can view all profiles" ON public.profiles;

CREATE POLICY "Anyone can view profiles"
  ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);