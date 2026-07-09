
-- Allow anyone to see admin and judge roles (needed to exclude them from public listings)
CREATE POLICY "Anyone can view admin and judge roles"
ON public.user_roles
FOR SELECT
USING (role IN ('admin', 'judge'));
