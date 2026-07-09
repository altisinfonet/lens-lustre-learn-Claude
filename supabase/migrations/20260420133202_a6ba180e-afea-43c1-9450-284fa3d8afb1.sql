-- Phase K: Cross-judge collusion detector
-- Pearson correlation between judge pairs over shared scored entries.
-- Flags pairs with |r| >= threshold AND overlap >= min_overlap.
-- Admin-only: gated by has_role(auth.uid(), 'admin').

CREATE OR REPLACE FUNCTION public.get_judge_collusion_admin(
  p_competition_id UUID DEFAULT NULL,
  p_min_overlap INT DEFAULT 10,
  p_min_correlation NUMERIC DEFAULT 0.9
)
RETURNS TABLE (
  competition_id UUID,
  judge_a UUID,
  judge_b UUID,
  shared_entries INT,
  pearson_r NUMERIC,
  mean_diff NUMERIC,
  severity TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  WITH paired AS (
    -- Per-(entry, photo_index) score from each judge, joined to its competition
    SELECT
      ce.competition_id,
      js.judge_id,
      js.entry_id,
      js.photo_index,
      js.score::NUMERIC AS score
    FROM judge_scores js
    JOIN competition_entries ce ON ce.id = js.entry_id
    WHERE js.score IS NOT NULL
      AND (p_competition_id IS NULL OR ce.competition_id = p_competition_id)
  ),
  pairs AS (
    -- Cartesian self-join: every ordered pair (a < b) of judges sharing an evaluation
    SELECT
      a.competition_id,
      a.judge_id AS judge_a,
      b.judge_id AS judge_b,
      a.score AS score_a,
      b.score AS score_b
    FROM paired a
    JOIN paired b
      ON a.competition_id = b.competition_id
     AND a.entry_id = b.entry_id
     AND a.photo_index = b.photo_index
     AND a.judge_id < b.judge_id
  ),
  agg AS (
    SELECT
      competition_id,
      judge_a,
      judge_b,
      COUNT(*)::INT AS n,
      CORR(score_a, score_b)::NUMERIC AS r,
      AVG(score_a - score_b)::NUMERIC AS mean_diff
    FROM pairs
    GROUP BY competition_id, judge_a, judge_b
    HAVING COUNT(*) >= p_min_overlap
  )
  SELECT
    a.competition_id,
    a.judge_a,
    a.judge_b,
    a.n,
    ROUND(a.r, 4),
    ROUND(a.mean_diff, 3),
    CASE
      WHEN ABS(a.r) >= 0.98 THEN 'critical'
      WHEN ABS(a.r) >= 0.95 THEN 'high'
      ELSE 'elevated'
    END AS severity
  FROM agg a
  WHERE a.r IS NOT NULL
    AND ABS(a.r) >= p_min_correlation
  ORDER BY ABS(a.r) DESC, a.n DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_judge_collusion_admin(UUID, INT, NUMERIC) TO authenticated;

COMMENT ON FUNCTION public.get_judge_collusion_admin IS
  'Phase K: Forensic collusion detector. Returns judge pairs with Pearson r >= threshold over >= min_overlap shared scored photos. Admin-only.';