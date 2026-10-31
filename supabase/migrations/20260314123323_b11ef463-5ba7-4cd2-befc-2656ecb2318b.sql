
-- Drop and recreate the policy to include 'submitted' status for public viewing
DROP POLICY IF EXISTS "Anyone can view approved entries" ON public.competition_entries;

CREATE POLICY "Anyone can view approved entries"
ON public.competition_entries
FOR SELECT
USING (
  (status = 'submitted'::text) OR (status = 'approved'::text) OR (status = 'winner'::text) OR (user_id = auth.uid())
);
