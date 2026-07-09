
CREATE TABLE public.ad_conversions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_id text NOT NULL,
  placement text NOT NULL,
  device text NOT NULL DEFAULT 'desktop',
  conversion_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid DEFAULT auth.uid()
);

ALTER TABLE public.ad_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all conversions"
  ON public.ad_conversions FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can insert conversions"
  ON public.ad_conversions FOR INSERT
  TO authenticated
  WITH CHECK (
    (char_length(ad_id) >= 1 AND char_length(ad_id) <= 120)
    AND (placement = ANY (ARRAY['header','sidebar','in-content','between-entries','lightbox-overlay','above-journal','below-journal']::text[]))
    AND (conversion_type = ANY (ARRAY['form_submission','payment_success','whatsapp_click','cta_click']::text[]))
    AND (device = ANY (ARRAY['desktop','mobile','tablet']::text[]))
  );

CREATE INDEX idx_ad_conversions_ad_id ON public.ad_conversions(ad_id);
CREATE INDEX idx_ad_conversions_type ON public.ad_conversions(conversion_type);
CREATE INDEX idx_ad_conversions_created ON public.ad_conversions(created_at);
