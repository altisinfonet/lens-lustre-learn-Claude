
-- Drop functions first to allow return type change
DROP FUNCTION IF EXISTS public.verify_certificate(uuid);
DROP FUNCTION IF EXISTS public.search_certificates(text, text, date);

-- Add columns
ALTER TABLE public.certificates
ADD COLUMN IF NOT EXISTS certificate_id TEXT,
ADD COLUMN IF NOT EXISTS verification_token TEXT;

-- Backfill existing rows
UPDATE public.certificates
SET certificate_id = 'CERT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 10)),
    verification_token = REPLACE(gen_random_uuid()::text, '-', '') || REPLACE(gen_random_uuid()::text, '-', '')
WHERE certificate_id IS NULL OR verification_token IS NULL;

-- Add unique constraints
ALTER TABLE public.certificates
ADD CONSTRAINT certificates_certificate_id_unique UNIQUE (certificate_id),
ADD CONSTRAINT certificates_verification_token_unique UNIQUE (verification_token);

-- Auto-generate trigger
CREATE OR REPLACE FUNCTION public.generate_certificate_identifiers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.certificate_id IS NULL THEN
    NEW.certificate_id := 'CERT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 10));
  END IF;
  IF NEW.verification_token IS NULL THEN
    NEW.verification_token := REPLACE(gen_random_uuid()::text, '-', '') || REPLACE(gen_random_uuid()::text, '-', '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_certificate_identifiers ON public.certificates;
CREATE TRIGGER trg_generate_certificate_identifiers
BEFORE INSERT ON public.certificates
FOR EACH ROW
EXECUTE FUNCTION public.generate_certificate_identifiers();

-- Token lookup function
CREATE OR REPLACE FUNCTION public.verify_certificate_by_token(_token text)
RETURNS TABLE(id uuid, title text, description text, type text, issued_at timestamp with time zone, recipient_name text, certificate_id text, verification_token text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.title, c.description, c.type, c.issued_at, p.full_name, c.certificate_id, c.verification_token
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.verification_token = _token
  LIMIT 1;
$$;

-- Recreate verify_certificate with new return type
CREATE OR REPLACE FUNCTION public.verify_certificate(_cert_id uuid)
RETURNS TABLE(id uuid, title text, description text, type text, issued_at timestamp with time zone, recipient_name text, certificate_id text, verification_token text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.title, c.description, c.type, c.issued_at, p.full_name, c.certificate_id, c.verification_token
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.id = _cert_id
  LIMIT 1;
$$;

-- Recreate search_certificates with new return type
CREATE OR REPLACE FUNCTION public.search_certificates(_name text DEFAULT NULL, _course_title text DEFAULT NULL, _issued_date date DEFAULT NULL)
RETURNS TABLE(id uuid, title text, description text, type text, issued_at timestamp with time zone, recipient_name text, certificate_id text, verification_token text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.title, c.description, c.type, c.issued_at, p.full_name, c.certificate_id, c.verification_token
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE
    (_name IS NULL OR p.full_name ILIKE '%' || _name || '%')
    AND (_course_title IS NULL OR c.title ILIKE '%' || _course_title || '%')
    AND (_issued_date IS NULL OR c.issued_at::date = _issued_date)
  ORDER BY c.issued_at DESC
  LIMIT 20;
$$;
