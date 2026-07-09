-- Recreate Phase 2.3 progression drift audit RPC.
-- Detects entries where stored progression_decision disagrees with deterministic
-- recomputation from raw judge_decisions (majority-vote aggregation per SOW).
-- Admin/super_admin only, SECURITY DEFINER, STABLE.

CREATE OR REPLACE FUNCTION public.get_progression_drift_admin()
RETURNS TABLE (
  entry_id uuid,
  competition_id uuid,
  title text,
  status text,
  stored_decision text,
  expected_decision text,
  total_decisions bigint,
  has_drift boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gate: admin or super_admin only
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH per_entry AS (
    SELECT
      e.id              AS entry_id,
      e.competition_id  AS competition_id,
      e.title           AS title,
      e.status          AS status,
      e.progression_decision AS stored_decision,
      e.updated_at      AS updated_at,
      (
        SELECT count(*)::bigint FROM public.judge_decisions jd
        WHERE jd.entry_id = e.id
      ) AS total_decisions,
      (
        -- Majority vote across the LATEST round that has any decisions.
        -- Tie or no decisions -> NULL (treated as "needs review").
        WITH latest_round AS (
          SELECT max(jd.round_number) AS rn
          FROM public.judge_decisions jd
          WHERE jd.entry_id = e.id
        ),
        tally AS (
          SELECT
            CASE
              WHEN lower(jd.decision) IN ('shortlist','shortlisted','qualified','accept','accepted') THEN 'qualified'
              WHEN lower(jd.decision) IN ('reject','rejected') THEN 'rejected'
              ELSE lower(jd.decision)
            END AS norm,
            count(*) AS n
          FROM public.judge_decisions jd, latest_round lr
          WHERE jd.entry_id = e.id
            AND jd.round_number = lr.rn
            AND jd.decision IS NOT NULL
          GROUP BY 1
        ),
        ranked AS (
          SELECT norm, n, rank() OVER (ORDER BY n DESC) AS rk, count(*) OVER () AS distinct_norms
          FROM tally
        )
        SELECT CASE
          WHEN (SELECT count(*) FROM tally) = 0 THEN NULL
          WHEN (SELECT count(*) FROM ranked WHERE rk = 1) > 1 THEN NULL  -- tie
          ELSE (SELECT norm FROM ranked WHERE rk = 1 LIMIT 1)
        END
      ) AS expected_decision
    FROM public.competition_entries e
  )
  SELECT
    pe.entry_id,
    pe.competition_id,
    pe.title,
    pe.status,
    pe.stored_decision,
    pe.expected_decision,
    pe.total_decisions,
    (
      pe.expected_decision IS NOT NULL
      AND coalesce(pe.stored_decision, '') <> coalesce(pe.expected_decision, '')
    ) AS has_drift,
    pe.updated_at
  FROM per_entry pe
  WHERE pe.expected_decision IS NOT NULL
    AND coalesce(pe.stored_decision, '') <> coalesce(pe.expected_decision, '')
  ORDER BY pe.updated_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_progression_drift_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_progression_drift_admin() TO authenticated;