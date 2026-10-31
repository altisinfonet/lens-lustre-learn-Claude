
CREATE OR REPLACE FUNCTION public.get_ad_autoscale_stats(_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH imp_agg AS (
    SELECT
      slot_id,
      ad_source,
      event_type,
      COUNT(*) AS cnt
    FROM public.ad_impressions
    WHERE created_at >= _since
      AND event_type IN ('impression', 'click')
    GROUP BY slot_id, ad_source, event_type
  ),
  conv_agg AS (
    SELECT
      ad_id,
      COUNT(*) AS cnt
    FROM public.ad_conversions
    WHERE created_at >= _since
    GROUP BY ad_id
  ),
  click_sources AS (
    SELECT DISTINCT ON (slot_id)
      slot_id,
      ad_source
    FROM public.ad_impressions
    WHERE created_at >= _since
      AND event_type = 'click'
    ORDER BY slot_id, created_at DESC
  )
  SELECT jsonb_build_object(
    'impressions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'slot_id', slot_id,
      'ad_source', ad_source,
      'event_type', event_type,
      'count', cnt
    )) FROM imp_agg), '[]'::jsonb),
    'conversions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'ad_id', ad_id,
      'count', cnt
    )) FROM conv_agg), '[]'::jsonb),
    'click_sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'slot_id', slot_id,
      'ad_source', ad_source
    )) FROM click_sources), '[]'::jsonb)
  );
$$;
