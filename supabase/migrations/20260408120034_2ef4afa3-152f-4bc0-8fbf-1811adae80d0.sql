CREATE POLICY "Authenticated can view admin roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (role = 'admin'::text);