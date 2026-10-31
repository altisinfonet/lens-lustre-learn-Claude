CREATE OR REPLACE FUNCTION public.search_profiles_admin(q text)
RETURNS TABLE (id uuid, full_name text, email text, avatar_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN;
  END IF;

  IF q IS NULL OR length(trim(q)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, u.email::text, p.avatar_url
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.full_name ILIKE '%' || q || '%'
     OR u.email      ILIKE '%' || q || '%'
  ORDER BY
    CASE WHEN p.full_name ILIKE q || '%' OR u.email ILIKE q || '%' THEN 0 ELSE 1 END,
    p.full_name NULLS LAST
  LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public.search_profiles_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles_admin(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_profile_admin(_id uuid)
RETURNS TABLE (id uuid, full_name text, email text, avatar_url text, bio text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, u.email::text, p.avatar_url, p.bio
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = _id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_admin(uuid) TO authenticated;