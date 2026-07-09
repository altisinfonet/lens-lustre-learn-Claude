-- Drop the security definer view
DROP VIEW IF EXISTS public.certificate_verification;

-- Create a security definer function for certificate verification lookup
-- This is safe because it only returns non-sensitive fields
CREATE OR REPLACE FUNCTION public.verify_certificate(_cert_id uuid)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  type text,
  issued_at timestamptz,
  recipient_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
  WHERE c.id = _cert_id
  LIMIT 1;
$$;