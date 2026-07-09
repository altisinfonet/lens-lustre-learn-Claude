CREATE POLICY "Anyone can read adjustment values"
ON public.admin_vote_adjustments
FOR SELECT
TO authenticated
USING (true);