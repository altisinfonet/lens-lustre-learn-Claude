-- Add featured fields to certificates
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS featured_quote text;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS featured_order integer NOT NULL DEFAULT 0;

-- Certificate testimonials table
CREATE TABLE IF NOT EXISTS public.certificate_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id uuid REFERENCES public.certificates(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  testimonial text NOT NULL,
  photo_url text,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.certificate_testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage testimonials" ON public.certificate_testimonials
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view visible testimonials" ON public.certificate_testimonials
  FOR SELECT USING (is_visible = true);

-- Certificate tier config will use site_settings table (no schema change needed)