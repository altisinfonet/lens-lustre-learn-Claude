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
         BOOL_OR(majority_decision IN ('shortlist','shortlisted')) AS s,
         BOOL_OR(majority_decision IN ('qualified','accept'))      AS q,
         BOOL_OR(majority_decision = 'needs_review')               AS n,
         BOOL_OR(majority_decision IN ('reject','rejected','skip')) AS r,
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
    WHEN ce.progression_decision IS NULL AND c.expected_decision IS NULL THEN false
    WHEN ce.progression_decision = 'accept' AND c.expected_decision = 'qualified' THEN false
    WHEN ce.progression_decision IS DISTINCT FROM c.expected_decision THEN true
    ELSE false
  END AS has_drift,
  ce.updated_at
FROM public.competition_entries ce
LEFT JOIN computed c ON c.entry_id = ce.id;

COMMENT ON VIEW public.judging_progression_audit IS
  'Phase 2.3 standing audit (v2). Recognizes raw decision vocabulary (shortlist/shortlisted, reject/rejected/skip). Treats accept↔qualified as equivalent.';