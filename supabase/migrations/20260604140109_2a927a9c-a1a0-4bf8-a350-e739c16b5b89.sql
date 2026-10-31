-- F2 Alt-A: SECURITY DEFINER RPC that exposes only non-sensitive roles, no bulk enumeration
CREATE OR REPLACE FUNCTION public.get_public_roles_for_users(_user_ids uuid[])
RETURNS TABLE(user_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id, ur.role::text
  FROM public.user_roles ur
  WHERE ur.user_id = ANY(_user_ids)
    AND ur.role::text IN ('registered_photographer','student','content_editor');
$$;

REVOKE ALL ON FUNCTION public.get_public_roles_for_users(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_roles_for_users(uuid[]) TO anon, authenticated;

-- Drop the three permissive policies that allowed anon enumeration
DROP POLICY IF EXISTS "Anyone can view registered_photographer roles" ON public.user_roles;
DROP POLICY IF EXISTS "Anyone can view student roles" ON public.user_roles;
DROP POLICY IF EXISTS "Public can view non-sensitive roles" ON public.user_roles;