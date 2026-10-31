-- Update ad_impressions RLS to include anchor-bottom placement
DROP POLICY IF EXISTS "Authenticated impression inserts" ON public.ad_impressions;
CREATE POLICY "Authenticated impression inserts" ON public.ad_impressions
  FOR INSERT TO authenticated
  WITH CHECK (
    (char_length(slot_id) >= 1) AND (char_length(slot_id) <= 120)
    AND (placement = ANY (ARRAY['header'::text, 'sidebar'::text, 'in-content'::text, 'between-entries'::text, 'lightbox-overlay'::text, 'above-journal'::text, 'below-journal'::text, 'anchor-bottom'::text]))
    AND (event_type = ANY (ARRAY['impression'::text, 'click'::text, 'viewable_impression'::text]))
    AND (device = ANY (ARRAY['desktop'::text, 'mobile'::text, 'tablet'::text]))
    AND (ad_source = ANY (ARRAY['internal'::text, 'adsense'::text]))
    AND ((country IS NULL) OR ((char_length(country) >= 2) AND (char_length(country) <= 100)))
  );

-- Update ad_conversions RLS to include anchor-bottom placement
DROP POLICY IF EXISTS "Authenticated users can insert conversions" ON public.ad_conversions;
CREATE POLICY "Authenticated users can insert conversions" ON public.ad_conversions
  FOR INSERT TO authenticated
  WITH CHECK (
    (char_length(ad_id) >= 1) AND (char_length(ad_id) <= 120)
    AND (placement = ANY (ARRAY['header'::text, 'sidebar'::text, 'in-content'::text, 'between-entries'::text, 'lightbox-overlay'::text, 'above-journal'::text, 'below-journal'::text, 'anchor-bottom'::text]))
    AND (conversion_type = ANY (ARRAY['form_submission'::text, 'payment_success'::text, 'whatsapp_click'::text, 'cta_click'::text]))
    AND (device = ANY (ARRAY['desktop'::text, 'mobile'::text, 'tablet'::text]))
  );