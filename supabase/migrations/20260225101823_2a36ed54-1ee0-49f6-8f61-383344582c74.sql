
-- Allow anyone to view student roles on public profiles
CREATE POLICY "Anyone can view student roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (role = 'student'::app_role);
