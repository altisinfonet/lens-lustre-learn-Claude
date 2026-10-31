
-- Add new profile fields for address, contact, and verification
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS national_id_url text;

-- Create storage bucket for national ID documents (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('national-ids', 'national-ids', false)
ON CONFLICT (id) DO NOTHING;

-- Only the user themselves and admins can access national IDs
CREATE POLICY "Users can upload own national ID"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'national-ids' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view own national ID"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'national-ids' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own national ID"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'national-ids' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Admins can view all national IDs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'national-ids' AND public.has_role(auth.uid(), 'admin'::public.app_role));
