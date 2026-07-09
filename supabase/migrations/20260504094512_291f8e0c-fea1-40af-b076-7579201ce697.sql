-- B1.7: Status drift audit (read-only)
-- Compares competition_entries.status vs entry_public_status.public_status (SOW canonical derivation)

CREATE OR REPLACE FUNCTION public.get_entry_status_drift_admin()
RETURNS TABLE(
  entry_id uuid,
  competition_id uuid,
  stored_status text,
  derived_status text,
  stored_placement text,
  derived_placement text,
  progression_decision text,
  current_round text,
  drift_kind text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_higher(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  WITH cmp AS (
    SELECT
      ce.id AS entry_id,
      ce.competition_id,
      ce.status AS stored_status,
      eps.public_status AS derived_status,
      ce.placement AS stored_placement,
      eps.public_placement AS derived_placement,
      ce.progression_decision,
      ce.current_round
    FROM public.competition_entries ce
    LEFT JOIN public.entry_public_status eps ON eps.entry_id = ce.id
  )
  SELECT
    c.entry_id,
    c.competition_id,
    c.stored_status,
    c.derived_status,
    c.stored_placement,
    c.derived_placement,
    c.progression_decision,
    c.current_round,
    CASE
      WHEN c.stored_status IS DISTINCT FROM c.derived_status
        AND c.stored_placement IS DISTINCT FROM c.derived_placement THEN 'status_and_placement_drift'
      WHEN c.stored_status IS DISTINCT FROM c.derived_status THEN 'status_drift'
      WHEN c.stored_placement IS DISTINCT FROM c.derived_placement THEN 'placement_drift'
      ELSE 'unknown'
    END AS drift_kind
  FROM cmp c
  WHERE
    -- exclude the legitimate pre-publish privacy gate
    NOT (c.derived_status = 'judging_in_progress'
         AND c.stored_status IN ('submitted','rejected','needs_review'))
    AND (
      c.stored_status IS DISTINCT FROM c.derived_status
      OR c.stored_placement IS DISTINCT FROM c.derived_placement
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_entry_status_drift_summary_admin()
RETURNS TABLE(bucket text, count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_higher(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  WITH cmp AS (
    SELECT
      ce.id AS entry_id,
      ce.status AS stored_status,
      eps.public_status AS derived_status,
      ce.placement AS stored_placement,
      eps.public_placement AS derived_placement
    FROM public.competition_entries ce
    LEFT JOIN public.entry_public_status eps ON eps.entry_id = ce.id
  ),
  classified AS (
    SELECT
      CASE
        WHEN stored_status = derived_status
             AND stored_placement IS NOT DISTINCT FROM derived_placement THEN 'match'
        WHEN derived_status = 'judging_in_progress'
             AND stored_status IN ('submitted','rejected','needs_review') THEN 'expected_pre_publish'
        ELSE 'DRIFT'
      END AS bucket
    FROM cmp
  )
  SELECT bucket, count(*)::bigint
  FROM classified
  GROUP BY bucket
  ORDER BY bucket;
END;
$$;

REVOKE ALL ON FUNCTION public.get_entry_status_drift_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_entry_status_drift_summary_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_entry_status_drift_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_entry_status_drift_summary_admin() TO authenticated;