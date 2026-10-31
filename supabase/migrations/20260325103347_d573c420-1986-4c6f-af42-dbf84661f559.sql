CREATE POLICY "Admins can delete applications"
ON public.role_applications
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));