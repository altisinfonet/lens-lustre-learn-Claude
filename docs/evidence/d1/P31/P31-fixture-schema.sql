CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.profiles (id uuid primary key default gen_random_uuid(), full_name text);
CREATE TABLE public.certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id),
  title text, description text, type text,
  issued_at timestamptz DEFAULT now(),
  certificate_id text,
  verification_token text,
  is_revoked boolean DEFAULT false,
  revoked_at timestamptz, revoked_reason text
);

-- Three real-shaped rows. Tokens are 64 hex chars, matching the production
-- measurement (tok_len_min=tok_len_max=64, hex only, 11/11 distinct).
INSERT INTO public.profiles (full_name) VALUES ('Ada Lovelace'),('Alan Turing'),('Grace Hopper');
INSERT INTO public.certificates (user_id, title, type, certificate_id, verification_token)
SELECT p.id, 'Landscape Award '||row_number() over (), 'award',
       'CERT-'||upper(substr(md5(p.full_name),1,10)),
       encode(digest(p.full_name,'sha256'),'hex')
  FROM public.profiles p;

-- Bodies copied verbatim from production, read 2026-09-04 via pg_get_functiondef.
CREATE FUNCTION public.search_certificates(_name text, _course_title text, _issued_date date)
RETURNS TABLE(id uuid, title text, description text, type text, issued_at timestamptz,
              recipient_name text, certificate_id text, verification_token text,
              is_revoked boolean, revoked_at timestamptz, revoked_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT c.id, c.title, c.description, c.type, c.issued_at,
         p.full_name, c.certificate_id, NULL::text AS verification_token,
         COALESCE(c.is_revoked, false), c.revoked_at, c.revoked_reason
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE
    (NULLIF(btrim(_name),'') IS NOT NULL OR NULLIF(btrim(_course_title),'') IS NOT NULL OR _issued_date IS NOT NULL)
    AND (_name IS NULL OR p.full_name ILIKE '%' || _name || '%')
    AND (_course_title IS NULL OR c.title ILIKE '%' || _course_title || '%')
    AND (_issued_date IS NULL OR DATE(c.issued_at) = _issued_date)
  ORDER BY c.issued_at DESC
  LIMIT 50;
$function$;

CREATE FUNCTION public.verify_certificate_by_token(_token text)
RETURNS TABLE(id uuid, title text, description text, type text, issued_at timestamptz,
              recipient_name text, certificate_id text, verification_token text,
              is_revoked boolean, revoked_at timestamptz, revoked_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT c.id, c.title, c.description, c.type, c.issued_at,
         p.full_name, c.certificate_id, c.verification_token,
         COALESCE(c.is_revoked, false), c.revoked_at, c.revoked_reason
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.verification_token = _token
  LIMIT 1;
$function$;

-- ⚠ Drive BOTH functions to the MEASURED acl string, the one WITH the leading
-- `=X/postgres` PUBLIC entry. CREATE FUNCTION already grants EXECUTE to PUBLIC
-- by the built-in default, so we ADD the three named roles and leave PUBLIC in
-- place — which is exactly how production got into this state.
GRANT EXECUTE ON FUNCTION public.search_certificates(text,text,date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_certificate_by_token(text)   TO anon, authenticated, service_role;
