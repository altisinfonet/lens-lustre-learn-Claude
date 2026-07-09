
CREATE TABLE public.ad_impressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id text NOT NULL,
  placement text NOT NULL,
  event_type text NOT NULL DEFAULT 'impression',
  device text NOT NULL DEFAULT 'desktop',
  country text,
  ad_source text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert impressions" ON public.ad_impressions
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view impressions" ON public.ad_impressions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_ad_impressions_slot ON public.ad_impressions(slot_id, created_at);
CREATE INDEX idx_ad_impressions_placement ON public.ad_impressions(placement, created_at);
CREATE INDEX idx_ad_impressions_event ON public.ad_impressions(event_type, created_at);
