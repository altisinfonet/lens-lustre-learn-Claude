-- Remove the overly permissive "anyone can view all" policy
DROP POLICY IF EXISTS "Anyone can view all assigned roles" ON public.user_roles;

-- Remove the policy that specifically exposes admin+judge roles publicly  
DROP POLICY IF EXISTS "Anyone can view admin and judge roles" ON public.user_roles;

-- Allow users to see non-sensitive roles (photographer, student, editor, artist, user) for display purposes
CREATE POLICY "Public can view non-sensitive roles"
ON public.user_roles
FOR SELECT
USING (role NOT IN ('judge', 'admin'));