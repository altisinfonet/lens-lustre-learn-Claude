
CREATE OR REPLACE FUNCTION public.search_certificates(
  _name text DEFAULT NULL,
  _course_title text DEFAULT NULL,
  _issued_date date DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  type text,
  issued_at timestamptz,
  recipient_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id,
    c.title,
    c.description,
    c.type,
    c.issued_at,
    p.full_name
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE
    (_name IS NULL OR p.full_name ILIKE '%' || _name || '%')
    AND (_course_title IS NULL OR c.title ILIKE '%' || _course_title || '%')
    AND (_issued_date IS NULL OR c.issued_at::date = _issued_date)
  ORDER BY c.issued_at DESC
  LIMIT 20;
$$;
