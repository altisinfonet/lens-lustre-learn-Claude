CREATE POLICY "Users can self-assign photographer role"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND role::text = 'registered_photographer'
);