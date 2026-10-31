
-- Allow anyone to check if a user has the registered_photographer role (for public profile badges)
CREATE POLICY "Anyone can view registered_photographer roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (role = 'registered_photographer'::app_role);
