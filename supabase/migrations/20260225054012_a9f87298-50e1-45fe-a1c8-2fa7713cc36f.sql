-- Drop the overly permissive public SELECT policy on profiles
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

-- Replace with authenticated-only SELECT
CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Restrict competition_votes SELECT to authenticated users only
DROP POLICY IF EXISTS "Anyone can view vote counts" ON public.competition_votes;

CREATE POLICY "Authenticated users can view vote counts"
  ON public.competition_votes
  FOR SELECT
  TO authenticated
  USING (true);