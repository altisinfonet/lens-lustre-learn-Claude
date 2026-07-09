
-- Function for admin to search users with email from auth.users
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
AS $$
BEGIN
  -- Only admins can call this
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  IF search_query = '' THEN
    -- Return all users
    RETURN QUERY
    SELECT 
      p.id,
      au.email::text,
      p.full_name,
      p.avatar_url,
      p.bio,
      p.is_suspended,
      p.suspended_until,
      p.suspension_reason,
      p.created_at
    FROM profiles p
    LEFT JOIN auth.users au ON au.id = p.id
    ORDER BY p.created_at DESC
    LIMIT 100;
  ELSIF search_by = 'email' THEN
    RETURN QUERY
    SELECT 
      p.id,
      au.email::text,
      p.full_name,
      p.avatar_url,
      p.bio,
      p.is_suspended,
      p.suspended_until,
      p.suspension_reason,
      p.created_at
    FROM profiles p
    LEFT JOIN auth.users au ON au.id = p.id
    WHERE au.email ILIKE '%' || search_query || '%'
    ORDER BY p.created_at DESC
    LIMIT 50;
  ELSE
    RETURN QUERY
    SELECT 
      p.id,
      au.email::text,
      p.full_name,
      p.avatar_url,
      p.bio,
      p.is_suspended,
      p.suspended_until,
      p.suspension_reason,
      p.created_at
    FROM profiles p
    LEFT JOIN auth.users au ON au.id = p.id
    WHERE p.full_name ILIKE '%' || search_query || '%'
    ORDER BY p.created_at DESC
    LIMIT 50;
  END IF;
END;
$$;

-- Also add admin update policy for profiles (needed for suspend/edit)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Admins can update profiles' AND tablename = 'profiles'
  ) THEN
    CREATE POLICY "Admins can update profiles" ON public.profiles FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Admins can delete profiles' AND tablename = 'profiles'
  ) THEN
    CREATE POLICY "Admins can delete profiles" ON public.profiles FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
