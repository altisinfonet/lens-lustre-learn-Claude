CREATE POLICY "Users can insert own certificates"
  ON public.certificates
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());