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
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  WITH paired AS (
    SELECT
      ce.competition_id AS comp_id,
      js.judge_id,
      js.entry_id,
      js.photo_index,
      js.score::NUMERIC AS score
    FROM public.judge_scores js
    JOIN public.competition_entries ce ON ce.id = js.entry_id
    JOIN public.competitions c ON c.id = ce.competition_id
    WHERE js.score IS NOT NULL
      AND c.status <> 'archived'
      AND (p_competition_id IS NULL OR ce.competition_id = p_competition_id)
  ),
  pairs AS (
    SELECT
      a.comp_id,
      a.judge_id AS judge_a,
      b.judge_id AS judge_b,
      a.score AS score_a,
      b.score AS score_b
    FROM paired a
    JOIN paired b
      ON a.comp_id = b.comp_id
     AND a.entry_id = b.entry_id
     AND a.photo_index = b.photo_index
     AND a.judge_id < b.judge_id
  ),
  agg AS (
    SELECT
      p.comp_id,
      p.judge_a,
      p.judge_b,
      COUNT(*)::INT AS n,
      CORR(p.score_a, p.score_b)::NUMERIC AS r,
      AVG(p.score_a - p.score_b)::NUMERIC AS avg_diff
    FROM pairs p
    GROUP BY p.comp_id, p.judge_a, p.judge_b
    HAVING COUNT(*) >= p_min_overlap
  )
  SELECT
    a.comp_id AS competition_id,
    a.judge_a,
    a.judge_b,
    a.n AS shared_entries,
    ROUND(a.r, 4) AS pearson_r,
    ROUND(a.avg_diff, 3) AS mean_diff,
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

REVOKE ALL ON FUNCTION public.get_judge_collusion_admin(UUID, INT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_judge_collusion_admin(UUID, INT, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_certificate_drift_admin(p_competition_id uuid DEFAULT NULL)
RETURNS TABLE (
  certificate_id uuid,
  cert_title text,
  cert_type text,
  cert_user_id uuid,
  reference_id uuid,
  entry_id uuid,
  entry_user_id uuid,
  entry_status text,
  entry_placement text,
  entry_certificate_ready boolean,
  competition_id uuid,
  issued_at timestamptz,
  drift_type text,
  severity text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  WITH cert_entry AS (
    SELECT
      c.id AS cert_id,
      c.title AS c_title,
      c.type AS c_type,
      c.user_id AS c_user,
      c.reference_id AS c_ref,
      c.issued_at AS c_issued,
      e.id AS e_id,
      e.user_id AS e_user,
      e.status AS e_status,
      e.placement AS e_placement,
      e.certificate_ready AS e_ready,
      e.competition_id AS comp_id,
      comp.status AS comp_status
    FROM public.certificates c
    JOIN public.competition_entries e ON e.id = c.reference_id
    JOIN public.competitions comp ON comp.id = e.competition_id
    WHERE c.reference_id IS NOT NULL
      AND c.type IN ('competition_winner','winner','finalist','participation')
      AND comp.status <> 'archived'
      AND (p_competition_id IS NULL OR e.competition_id = p_competition_id)
  )
  SELECT
    cert_id, c_title, c_type, c_user, c_ref,
    e_id, e_user, e_status, e_placement, e_ready, comp_id,
    c_issued,
    'wrong_recipient'::text,
    'critical'::text,
    format('Certificate user_id (%s) does not match entry owner (%s)', c_user, e_user)
  FROM cert_entry
  WHERE c_user IS DISTINCT FROM e_user

  UNION ALL
  SELECT
    cert_id, c_title, c_type, c_user, c_ref,
    e_id, e_user, e_status, e_placement, e_ready, comp_id,
    c_issued,
    'stale_eligibility'::text,
    'high'::text,
    'Certificate issued but entry is no longer certificate_ready (entry may have been reverted)'::text
  FROM cert_entry
  WHERE e_ready = false

  UNION ALL
  SELECT
    cert_id, c_title, c_type, c_user, c_ref,
    e_id, e_user, e_status, e_placement, e_ready, comp_id,
    c_issued,
    'type_mismatch'::text,
    'elevated'::text,
    format('Cert type "%s" does not match entry placement "%s" / status "%s"', c_type, COALESCE(e_placement,'—'), COALESCE(e_status,'—'))
  FROM cert_entry
  WHERE (c_type IN ('winner','competition_winner') AND e_placement IS DISTINCT FROM 'winner')
     OR (c_type = 'finalist' AND e_status NOT IN ('finalist','round2_qualified','round1_qualified'))

  ORDER BY 14, 13;
END;
$$;

REVOKE ALL ON FUNCTION public.get_certificate_drift_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_certificate_drift_admin(uuid) TO authenticated;