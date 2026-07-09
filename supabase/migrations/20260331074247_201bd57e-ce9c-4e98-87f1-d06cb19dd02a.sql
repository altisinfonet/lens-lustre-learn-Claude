
CREATE OR REPLACE FUNCTION public.get_ad_analytics(_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH imp_agg AS (
    SELECT
      slot_id,
      placement,
      device,
      ad_source,
      event_type,
      COUNT(*) AS cnt,
      COALESCE(SUM(revenue_estimate), 0) AS revenue
    FROM public.ad_impressions
    WHERE created_at >= _since
    GROUP BY slot_id, placement, device, ad_source, event_type
  ),
  conv_agg AS (
    SELECT
      ad_id,
      placement,
      device,
      conversion_type,
      COUNT(*) AS cnt,
      COALESCE(SUM(conversion_value), 0) AS conv_value
    FROM public.ad_conversions
    WHERE created_at >= _since
    GROUP BY ad_id, placement, device, conversion_type
  )
  SELECT jsonb_build_object(
    'impressions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'slot_id', slot_id,
      'placement', placement,
      'device', device,
      'ad_source', ad_source,
      'event_type', event_type,
      'count', cnt,
      'revenue', revenue
    )) FROM imp_agg), '[]'::jsonb),
    'conversions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'ad_id', ad_id,
      'placement', placement,
      'device', device,
      'conversion_type', conversion_type,
      'count', cnt,
      'conv_value', conv_value
    )) FROM conv_agg), '[]'::jsonb)
  );
$$;
