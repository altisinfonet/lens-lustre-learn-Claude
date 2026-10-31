-- ─── F4: Deterministic tie-break composite score ───
-- Returns a sortable numeric: aggregate*1e9 + composition*1e6 + light*1e3 + (1 - submission_seconds/1e10)
-- Higher = better. Used to break ties in placement ranking.
CREATE OR REPLACE FUNCTION public.compute_entry_rank_score(_entry_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT 
      AVG(COALESCE(js.score, 0)) AS avg_score,
      AVG(COALESCE(js.composition_score, 0)) AS avg_comp,
      AVG(COALESCE(js.light_score, 0)) AS avg_light
    FROM judge_scores js
    WHERE js.entry_id = _entry_id
  ),
  e AS (
    SELECT EXTRACT(EPOCH FROM created_at) AS subs
    FROM competition_entries WHERE id = _entry_id
  )
  SELECT 
    COALESCE(agg.avg_score, 0) * 1000000000
    + COALESCE(agg.avg_comp, 0) * 1000000
    + COALESCE(agg.avg_light, 0) * 1000
    + (1.0 - COALESCE(e.subs, 0) / 100000000000.0)
  FROM agg, e;
$$;

-- ─── F2: Placement drift — admin only ───
-- Flags: (a) status≠placement mismatch, (b) winner not top-ranked, (c) runner_up_1 not 2nd-ranked
CREATE OR REPLACE FUNCTION public.get_placement_drift_admin(_competition_id uuid DEFAULT NULL)
RETURNS TABLE (
  entry_id uuid,
  competition_id uuid,
  competition_title text,
  status text,
  placement text,
  rank_score numeric,
  expected_rank int,
  actual_award_rank int,
  drift_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH r4_entries AS (
    SELECT ce.id, ce.competition_id, ce.status, ce.placement,
           c.title AS comp_title,
           compute_entry_rank_score(ce.id) AS rank_score
    FROM competition_entries ce
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.current_round = '4'
      AND (_competition_id IS NULL OR ce.competition_id = _competition_id)
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY competition_id ORDER BY rank_score DESC) AS expected_rank
    FROM r4_entries
  ),
  award_rank AS (
    SELECT *,
      CASE status
        WHEN 'winner' THEN 1
        WHEN 'runner_up_1' THEN 2
        WHEN 'runner_up_2' THEN 3
        WHEN 'special_jury' THEN 4
        WHEN 'honourable_mention' THEN 5
        ELSE NULL
      END AS actual_award_rank
    FROM ranked
  )
  SELECT 
    ar.id, ar.competition_id, ar.comp_title, ar.status, ar.placement,
    ar.rank_score, ar.expected_rank::int, ar.actual_award_rank,
    CASE
      WHEN ar.status IN ('winner','runner_up_1','runner_up_2','special_jury','honourable_mention')
           AND ar.placement IS DISTINCT FROM ar.status
        THEN 'status_placement_mismatch'
      WHEN ar.status = 'winner' AND ar.expected_rank > 1
        THEN 'winner_not_top_ranked'
      WHEN ar.status = 'runner_up_1' AND ar.expected_rank > 2
        THEN 'runner_up_1_below_2nd_rank'
      ELSE NULL
    END AS drift_reason
  FROM award_rank ar
  WHERE 
    (ar.status IN ('winner','runner_up_1','runner_up_2','special_jury','honourable_mention')
     AND ar.placement IS DISTINCT FROM ar.status)
    OR (ar.status = 'winner' AND ar.expected_rank > 1)
    OR (ar.status = 'runner_up_1' AND ar.expected_rank > 2);
END;
$$;

-- ─── F3: Certificate readiness audit — admin only ───
-- Flags entries that SHOULD have certificate_ready=true but don't:
--   - Any awarded status (winner / runner_up_* / special_jury / honourable_mention)
--   - finalist / round1_qualified / round2_qualified / shortlisted in completed comps
CREATE OR REPLACE FUNCTION public.get_certificate_readiness_drift_admin(_competition_id uuid DEFAULT NULL)
RETURNS TABLE (
  entry_id uuid,
  competition_id uuid,
  competition_title text,
  competition_phase text,
  status text,
  certificate_ready boolean,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    ce.id, ce.competition_id, c.title, c.phase, ce.status, ce.certificate_ready,
    CASE
      WHEN ce.status IN ('winner','runner_up_1','runner_up_2','special_jury','honourable_mention')
        THEN 'awarded_missing_certificate'
      WHEN ce.status IN ('finalist','round1_qualified','round2_qualified','shortlisted')
           AND c.phase = 'result'
        THEN 'qualified_in_completed_comp_missing_certificate'
      ELSE 'unexpected'
    END AS reason
  FROM competition_entries ce
  JOIN competitions c ON c.id = ce.competition_id
  WHERE ce.certificate_ready = false
    AND (_competition_id IS NULL OR ce.competition_id = _competition_id)
    AND (
      ce.status IN ('winner','runner_up_1','runner_up_2','special_jury','honourable_mention')
      OR (ce.status IN ('finalist','round1_qualified','round2_qualified','shortlisted')
          AND c.phase = 'result')
    );
END;
$$;

-- ─── Admin-only fix: backfill certificate_ready ───
CREATE OR REPLACE FUNCTION public.fix_certificate_readiness_admin(_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  IF NOT has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE competition_entries 
    SET certificate_ready = true, updated_at = now()
    WHERE id = _entry_id;

  INSERT INTO db_audit_logs (table_name, operation, row_id, new_data, changed_by)
  VALUES ('competition_entries', 'CERT_READY_BACKFILL', _entry_id::text, 
          jsonb_build_object('certificate_ready', true, 'fixed_by', v_admin),
          v_admin);

  RETURN jsonb_build_object('ok', true, 'entry_id', _entry_id);
END;
$$;