-- Allow anonymous users to view profiles via profiles_public view
CREATE POLICY "Anyone can view public profiles"
ON public.profiles
FOR SELECT
TO anon
USING (true);