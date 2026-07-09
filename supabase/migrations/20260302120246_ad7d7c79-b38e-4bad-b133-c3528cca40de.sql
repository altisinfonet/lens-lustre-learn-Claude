
-- Add attachment_url column to ticket_replies
ALTER TABLE public.ticket_replies ADD COLUMN IF NOT EXISTS attachment_url text DEFAULT NULL;
ALTER TABLE public.ticket_replies ADD COLUMN IF NOT EXISTS attachment_name text DEFAULT NULL;

-- Create storage bucket for support attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-attachments', 'support-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: Users can upload their own support attachments
CREATE POLICY "Users can upload support attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: Users can view their own attachments
CREATE POLICY "Users can view own support attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: Admins can view all support attachments
CREATE POLICY "Admins can view all support attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'support-attachments' AND has_role(auth.uid(), 'admin'::app_role));

-- RLS: Admins can upload support attachments
CREATE POLICY "Admins can upload support attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'support-attachments' AND has_role(auth.uid(), 'admin'::app_role));
