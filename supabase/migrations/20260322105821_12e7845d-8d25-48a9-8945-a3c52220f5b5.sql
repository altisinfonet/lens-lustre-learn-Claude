-- Fix double-encoded JSON string values for on-page images
UPDATE public.site_settings 
SET value = (value #>> '{}')::jsonb
WHERE key IN ('site_logo', 'quote_background_image')
  AND jsonb_typeof(value) = 'string'
  AND (value #>> '{}') LIKE '"%"';