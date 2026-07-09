-- Safe public function to check if S3 storage is enabled
-- Returns only the boolean flag, never exposes credentials
CREATE OR REPLACE FUNCTION public.is_s3_storage_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (value->>'enabled')::boolean
     FROM public.site_settings
     WHERE key = 's3_storage_settings'),
    false
  )
$$;