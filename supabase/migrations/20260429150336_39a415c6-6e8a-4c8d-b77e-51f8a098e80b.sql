DROP FUNCTION IF EXISTS public.verify_certificate_by_token(text);
DROP FUNCTION IF EXISTS public.verify_certificate(uuid);
DROP FUNCTION IF EXISTS public.search_certificates(text, text, date);

CREATE FUNCTION public.verify_certificate_by_token(_token text)
RETURNS TABLE(
  id uuid, title text, description text, type text,
  issued_at timestamp with time zone, recipient_name text,
  certificate_id text, verification_token text,
  is_revoked boolean, revoked_at timestamp with time zone, revoked_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.title, c.description, c.type, c.issued_at,
         p.full_name, c.certificate_id, c.verification_token,
         COALESCE(c.is_revoked, false), c.revoked_at, c.revoked_reason
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.verification_token = _token
  LIMIT 1;
$function$;

CREATE FUNCTION public.verify_certificate(_cert_id uuid)
RETURNS TABLE(
  id uuid, title text, description text, type text,
  issued_at timestamp with time zone, recipient_name text,
  certificate_id text, verification_token text,
  is_revoked boolean, revoked_at timestamp with time zone, revoked_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.title, c.description, c.type, c.issued_at,
         p.full_name, c.certificate_id, c.verification_token,
         COALESCE(c.is_revoked, false), c.revoked_at, c.revoked_reason
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.id = _cert_id
  LIMIT 1;
$function$;

CREATE FUNCTION public.search_certificates(_name text, _course_title text, _issued_date date)
RETURNS TABLE(
  id uuid, title text, description text, type text,
  issued_at timestamp with time zone, recipient_name text,
  certificate_id text, verification_token text,
  is_revoked boolean, revoked_at timestamp with time zone, revoked_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.title, c.description, c.type, c.issued_at,
         p.full_name, c.certificate_id, c.verification_token,
         COALESCE(c.is_revoked, false), c.revoked_at, c.revoked_reason
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE
    (_name IS NULL OR p.full_name ILIKE '%' || _name || '%')
    AND (_course_title IS NULL OR c.title ILIKE '%' || _course_title || '%')
    AND (_issued_date IS NULL OR DATE(c.issued_at) = _issued_date)
  ORDER BY c.issued_at DESC
  LIMIT 50;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_certificate_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_certificates(text, text, date) TO anon, authenticated;
