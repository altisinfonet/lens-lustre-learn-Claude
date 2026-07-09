-- Create a minimal public view for display purposes only
CREATE VIEW public.profiles_public
WITH (security_invoker = on) AS
  SELECT id, full_name, avatar_url
  FROM public.profiles;

-- Allow anon to read the public view by granting select on profiles to anon via a separate policy
-- Since the view uses security_invoker, we need a policy that allows the view caller to read
-- We need to re-add a limited anon SELECT policy on profiles for the view to work
CREATE POLICY "Anon can view basic profile info"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (true);