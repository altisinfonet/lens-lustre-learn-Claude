UPDATE site_settings 
SET value = jsonb_set(
  value::jsonb, 
  '{canonical_base}', 
  '"https://50mmretina.com"'
)
WHERE key = 'seo_global';