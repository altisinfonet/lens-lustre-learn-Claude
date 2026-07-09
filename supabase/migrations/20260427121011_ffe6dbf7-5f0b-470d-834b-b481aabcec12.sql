-- Clear the broken admin-saved Brevo API key so process-email-queue
-- falls back to the verified BREVO_API_KEY env secret (Brevo /v3/account
-- returns 401 "Key not found" for the admin-saved key but 200 for the
-- env-secret key). Preserves provider + other smtp_settings fields.
UPDATE public.site_settings
SET value = (value - 'api_key'),
    updated_at = now()
WHERE key = 'smtp_settings'
  AND value ? 'api_key';