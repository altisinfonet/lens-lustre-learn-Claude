-- Clean up: drop the redundant anon policy since profiles data (names, avatars, bios) is intentionally public
-- The "Authenticated users can view profiles" + "Anon can view basic profile info" together cover all cases
-- But let's simplify back to one clean policy
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Anon can view basic profile info" ON public.profiles;

-- Single clean policy: profiles are public display data (no PII like emails)
CREATE POLICY "Anyone can view profiles"
  ON public.profiles
  FOR SELECT
  USING (true);

-- Drop the view since it's not needed
DROP VIEW IF EXISTS public.profiles_public;