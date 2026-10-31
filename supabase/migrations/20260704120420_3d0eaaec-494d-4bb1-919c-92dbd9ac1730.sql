
CREATE OR REPLACE FUNCTION public.get_primary_admin_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id
  FROM public.user_roles
  WHERE role = 'admin'
  ORDER BY created_at ASC NULLS LAST, user_id ASC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_primary_admin_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_primary_admin_user_id() TO authenticated;
