
-- Fix search_path for admin_search_users function
CREATE OR REPLACE FUNCTION public.admin_search_users(
  search_query text DEFAULT '',
  search_by text DEFAULT 'name'
)
RETURNS TABLE(
  id uuid,
  email text,
  full_name text,
  avatar_url text,
  bio text,
  is_suspended boolean,
  suspended_until timestamptz,
  suspension_reason text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  IF search_query = '' THEN
    RETURN QUERY
    SELECT p.id, au.email::text, p.full_name, p.avatar_url, p.bio, p.is_suspended, p.suspended_until, p.suspension_reason, p.created_at
    FROM public.profiles p
    LEFT JOIN auth.users au ON au.id = p.id
    ORDER BY p.created_at DESC LIMIT 100;
  ELSIF search_by = 'email' THEN
    RETURN QUERY
    SELECT p.id, au.email::text, p.full_name, p.avatar_url, p.bio, p.is_suspended, p.suspended_until, p.suspension_reason, p.created_at
    FROM public.profiles p
    LEFT JOIN auth.users au ON au.id = p.id
    WHERE au.email ILIKE '%' || search_query || '%'
    ORDER BY p.created_at DESC LIMIT 50;
  ELSE
    RETURN QUERY
    SELECT p.id, au.email::text, p.full_name, p.avatar_url, p.bio, p.is_suspended, p.suspended_until, p.suspension_reason, p.created_at
    FROM public.profiles p
    LEFT JOIN auth.users au ON au.id = p.id
    WHERE p.full_name ILIKE '%' || search_query || '%'
    ORDER BY p.created_at DESC LIMIT 50;
  END IF;
END;
$$;
