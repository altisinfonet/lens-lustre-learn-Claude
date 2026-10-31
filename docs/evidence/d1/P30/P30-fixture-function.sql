CREATE FUNCTION public.email_exists(_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ select exists (select 1 from auth.users where lower(email) = lower(_email)); $function$;
REVOKE ALL ON FUNCTION public.email_exists(text) FROM public;
GRANT EXECUTE ON FUNCTION public.email_exists(text) TO anon, authenticated, service_role;
