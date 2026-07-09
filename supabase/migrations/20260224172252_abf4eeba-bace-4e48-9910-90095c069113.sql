-- Create a public view for certificate verification that hides user_id
-- We join profiles to show the recipient name
CREATE VIEW public.certificate_verification
WITH (security_invoker = off) AS
SELECT
  c.id,
  c.title,
  c.description,
  c.type,
  c.issued_at,
  p.full_name as recipient_name
FROM public.certificates c
LEFT JOIN public.profiles p ON p.id = c.user_id;

-- Allow anyone to select from the view
GRANT SELECT ON public.certificate_verification TO anon, authenticated;