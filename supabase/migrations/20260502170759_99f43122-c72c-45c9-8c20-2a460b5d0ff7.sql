ALTER VIEW public.entry_public_status SET (security_invoker = on);

CREATE OR REPLACE FUNCTION public.get_result_visibility_invariant_admin()
RETURNS TABLE(
  check_key text,
  status text,
  evidence jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH latest_published AS (
    SELECT competition_id, max(round_number) FILTER (WHERE published_at IS NOT NULL) AS latest_published_round
    FROM public.competition_round_publish
    GROUP BY competition_id
  ), eligible AS (
    SELECT
      e.id AS entry_id,
      e.competition_id,
      e.status AS raw_status,
      e.progression_decision,
      e.current_round,
      c.round_number AS decision_round,
      lp.latest_published_round,
      eps.public_status AS view_status,
      ges.public_status AS rpc_status
    FROM public.competition_entries e
    JOIN latest_published lp ON lp.competition_id = e.competition_id
    JOIN public.v3_stage_catalog c
      ON c.stage_key = e.progression_decision
     AND c.is_active = true
    JOIN public.entry_public_status eps ON eps.entry_id = e.id
    LEFT JOIN LATERAL (
      SELECT public_status FROM public.get_gated_entry_status(ARRAY[e.id]) LIMIT 1
    ) ges ON true
    WHERE lp.latest_published_round IS NOT NULL
      AND c.round_number <= lp.latest_published_round
  ), failures AS (
    SELECT *
    FROM eligible
    WHERE view_status = 'judging_in_progress'
       OR rpc_status = 'judging_in_progress'
       OR view_status IS DISTINCT FROM progression_decision
       OR rpc_status IS DISTINCT FROM progression_decision
  )
  SELECT
    'published_round_results_visible'::text AS check_key,
    CASE WHEN EXISTS (SELECT 1 FROM failures) THEN 'FAIL' ELSE 'PASS' END AS status,
    jsonb_build_object(
      'eligible_published_decisions', (SELECT count(*) FROM eligible),
      'failures', COALESCE((SELECT jsonb_agg(to_jsonb(failures) ORDER BY entry_id) FROM failures), '[]'::jsonb)
    ) AS evidence;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_result_visibility_invariant_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_result_visibility_invariant_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_result_visibility_invariant_admin() TO authenticated;