-- Standing audit view: drift between stored progression_decision and deterministic SOW recomputation
CREATE OR REPLACE VIEW public.judging_progression_audit
WITH (security_invoker = true)
AS
WITH per_photo AS (
  SELECT entry_id, photo_index,
         MODE() WITHIN GROUP (ORDER BY decision) AS majority_decision,
         COUNT(*) AS judge_count
  FROM public.judge_decisions
  GROUP BY entry_id, photo_index
),
agg AS (
  SELECT entry_id,
         BOOL_OR(majority_decision = 'shortlisted') AS s,
         BOOL_OR(majority_decision IN ('qualified','accept')) AS q,
         BOOL_OR(majority_decision = 'needs_review') AS n,
         BOOL_OR(majority_decision = 'reject') AS r,
         SUM(judge_count) AS total_decisions
  FROM per_photo GROUP BY entry_id
),
computed AS (
  SELECT entry_id,
         CASE WHEN s THEN 'shortlisted'
              WHEN q THEN 'qualified'
              WHEN n THEN 'needs_review'
              WHEN r THEN 'reject'
              ELSE NULL END AS expected_decision,
         total_decisions
  FROM agg
)
SELECT
  ce.id AS entry_id,
  ce.competition_id,
  ce.title,
  ce.status,
  ce.progression_decision AS stored_decision,
  c.expected_decision,
  c.total_decisions,
  CASE
    WHEN ce.progression_decision IS DISTINCT FROM c.expected_decision THEN true
    ELSE false
  END AS has_drift,
  ce.updated_at
FROM public.competition_entries ce
LEFT JOIN computed c ON c.entry_id = ce.id;

COMMENT ON VIEW public.judging_progression_audit IS
  'Phase 2.3 standing audit. Surfaces drift between stored progression_decision and deterministic SOW aggregation. Admin-only access enforced by underlying tables.';

-- Restrict view: revoke public, allow only admins via direct grant
REVOKE ALL ON public.judging_progression_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.judging_progression_audit TO authenticated;

-- Wrap in a security-definer function admins can call safely
CREATE OR REPLACE FUNCTION public.get_progression_drift()
RETURNS SETOF public.judging_progression_audit
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.judging_progression_audit
  WHERE has_drift = true
$$;

REVOKE ALL ON FUNCTION public.get_progression_drift() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_progression_drift() TO authenticated;

-- Gate the function: only admins may call
CREATE OR REPLACE FUNCTION public.get_progression_drift_admin()
RETURNS SETOF public.judging_progression_audit
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.judging_progression_audit WHERE has_drift = true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_progression_drift_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_progression_drift_admin() TO authenticated;

-- Drop the unguarded helper (we keep only the admin-gated one)
DROP FUNCTION IF EXISTS public.get_progression_drift();