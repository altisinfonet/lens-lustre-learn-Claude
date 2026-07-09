
-- Allow admins to delete admin notifications
CREATE POLICY "Admins can delete admin notifications"
ON public.admin_notifications
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
