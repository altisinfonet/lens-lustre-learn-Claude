
CREATE OR REPLACE FUNCTION public.get_public_role_user_ids(_role text)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only expose roles that are safe to enumerate app-wide.
  IF _role NOT IN ('admin', 'judge') THEN
    RAISE EXCEPTION 'role % is not enumerable', _role USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role::text = _role;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_role_user_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_role_user_ids(text) TO authenticated;
