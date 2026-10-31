
-- Create portfolio_images table
CREATE TABLE public.portfolio_images (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  image_url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  uploaded_by uuid NOT NULL
);

-- Enable RLS
ALTER TABLE public.portfolio_images ENABLE ROW LEVEL SECURITY;

-- Anyone can view visible portfolio images (public gallery)
CREATE POLICY "Anyone can view visible portfolio images"
  ON public.portfolio_images FOR SELECT
  USING (is_visible = true);

-- Admins can manage all portfolio images
CREATE POLICY "Admins can manage portfolio images"
  ON public.portfolio_images FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create storage bucket for portfolio images
INSERT INTO storage.buckets (id, name, public)
VALUES ('portfolio-images', 'portfolio-images', true);

-- Allow admins to upload to portfolio-images bucket
CREATE POLICY "Admins can upload portfolio images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'portfolio-images' AND has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to delete portfolio images
CREATE POLICY "Admins can delete portfolio images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'portfolio-images' AND has_role(auth.uid(), 'admin'::app_role));

-- Anyone can view portfolio images
CREATE POLICY "Anyone can view portfolio bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'portfolio-images');
