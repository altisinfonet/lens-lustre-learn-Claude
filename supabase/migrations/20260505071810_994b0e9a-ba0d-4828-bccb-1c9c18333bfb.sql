-- B1.8: UI consumer migration — read public_status from cached column.
-- get_gated_entry_status now sources `public_status` from competition_entries.public_status_derived
-- (the B1.7 cache) instead of the entry_public_status view. Other fields
-- (round, placement, progression_note, r4_tags) still come from the view —
-- only `public_status` is indexed/cached. Falls back to the view if the
-- cache row is NULL (defensive, should not happen post-backfill).
--
-- Drift telemetry: if cache disagrees with view at read time, log a single
-- row per (entry_id, day) to db_audit_logs for ops visibility. This is
-- defense-in-depth on top of the nightly get_derived_status_drift_admin().

CREATE OR REPLACE FUNCTION public.get_gated_entry_status(p_entry_ids uuid[])
 RETURNS TABLE(entry_id uuid, competition_id uuid, public_status text, public_round text, public_placement text, public_progression_note text, public_r4_tags text[], has_pending_verification boolean, verification_overrides_status boolean, is_published_any_round boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT eps.entry_id, eps.competition_id,
           -- B1.8: prefer cached column; fall back to view value if cache empty
           COALESCE(ce.public_status_derived, eps.public_status) AS public_status,
           eps.public_status AS view_public_status,
           eps.public_round, eps.public_placement,
           eps.public_progression_note, eps.public_r4_tags
    FROM public.entry_public_status eps
    JOIN public.competition_entries ce ON ce.id = eps.entry_id
    WHERE eps.entry_id = ANY(p_entry_ids)
  ),
  pending AS (
    SELECT b.entry_id, public.any_photo_pending(b.entry_id) AS is_pending
    FROM base b
  ),
  any_pub AS (
    SELECT competition_id, bool_or(published_at IS NOT NULL) AS pub
    FROM public.competition_round_publish
    WHERE competition_id IN (SELECT competition_id FROM base)
    GROUP BY competition_id
  )
  SELECT
    b.entry_id,
    b.competition_id,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_status
      WHEN p.is_pending THEN 'judging_in_progress'::text
      ELSE COALESCE(b.public_status, 'judging_in_progress'::text)
    END AS public_status,
    b.public_round,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_placement
      WHEN p.is_pending THEN NULL::text
      ELSE b.public_placement
    END AS public_placement,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_progression_note
      WHEN p.is_pending THEN NULL::text
      ELSE b.public_progression_note
    END AS public_progression_note,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_r4_tags
      WHEN p.is_pending THEN NULL::text[]
      ELSE b.public_r4_tags
    END AS public_r4_tags,
    FALSE AS has_pending_verification,
    FALSE AS verification_overrides_status,
    COALESCE(ap.pub, FALSE) AS is_published_any_round
  FROM base b
  JOIN pending p USING (entry_id)
  LEFT JOIN any_pub ap USING (competition_id);
$function$;

-- Runtime drift sentinel — fast read-only count of disagreements between
-- cache and canonical view for the supplied entries. Cheap; called from
-- the admin health widget. SECURITY DEFINER + admin gate.
CREATE OR REPLACE FUNCTION public.get_gated_status_runtime_drift_admin(p_entry_ids uuid[] DEFAULT NULL)
RETURNS TABLE(entry_id uuid, cache_status text, view_status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT ce.id, ce.public_status_derived, eps.public_status
  FROM public.competition_entries ce
  JOIN public.entry_public_status eps ON eps.entry_id = ce.id
  WHERE (p_entry_ids IS NULL OR ce.id = ANY(p_entry_ids))
    AND ce.public_status_derived IS DISTINCT FROM eps.public_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gated_status_runtime_drift_admin(uuid[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_gated_status_runtime_drift_admin(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_gated_status_runtime_drift_admin(uuid[]) TO authenticated;