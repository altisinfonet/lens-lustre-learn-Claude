-- 1. Restrict ad_impressions: drop anon INSERT, replace with authenticated-only
DROP POLICY IF EXISTS "Validated impression inserts" ON public.ad_impressions;

CREATE POLICY "Authenticated impression inserts"
ON public.ad_impressions
FOR INSERT
TO authenticated
WITH CHECK (
  ((char_length(slot_id) >= 1) AND (char_length(slot_id) <= 120))
  AND (placement = ANY (ARRAY['header','sidebar','in-content','between-entries','lightbox-overlay','above-journal','below-journal']))
  AND (event_type = ANY (ARRAY['impression','click']))
  AND (device = ANY (ARRAY['desktop','mobile','tablet']))
  AND (ad_source = ANY (ARRAY['internal','adsense']))
  AND ((country IS NULL) OR ((char_length(country) >= 2) AND (char_length(country) <= 100)))
);

-- 2. Restrict profile_views: drop public INSERT, replace with authenticated-only
DROP POLICY IF EXISTS "Validated profile view inserts" ON public.profile_views;

CREATE POLICY "Authenticated profile view inserts"
ON public.profile_views
FOR INSERT
TO authenticated
WITH CHECK (
  (profile_id IS NOT NULL)
  AND (viewer_id = auth.uid())
);