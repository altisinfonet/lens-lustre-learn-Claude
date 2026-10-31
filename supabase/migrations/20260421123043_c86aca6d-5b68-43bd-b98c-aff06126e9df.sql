CREATE OR REPLACE FUNCTION public.get_placement_drift_admin(_competition_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entry_id uuid, competition_id uuid, competition_title text, status text, placement text, rank_score numeric, expected_rank integer, actual_award_rank integer, drift_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH r4_entries AS (
    SELECT ce.id AS e_id, ce.competition_id AS comp_id, ce.status AS e_status, ce.placement AS e_placement,
           c.title AS comp_title,
           compute_entry_rank_score(ce.id) AS r_score
    FROM competition_entries ce
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.current_round = '4'
      AND (_competition_id IS NULL OR ce.competition_id = _competition_id)
  ),
  ranked AS (
    SELECT r.*,
      ROW_NUMBER() OVER (PARTITION BY r.comp_id ORDER BY r.r_score DESC) AS exp_rank
    FROM r4_entries r
  ),
  award_rank AS (
    SELECT rk.*,
      CASE rk.e_status
        WHEN 'winner' THEN 1
        WHEN 'runner_up_1' THEN 2
        WHEN 'runner_up_2' THEN 3
        WHEN 'special_jury' THEN 4
        WHEN 'honourable_mention' THEN 5
        ELSE NULL
      END AS act_award_rank
    FROM ranked rk
  )
  SELECT
    ar.e_id, ar.comp_id, ar.comp_title, ar.e_status, ar.e_placement,
    ar.r_score, ar.exp_rank::int, ar.act_award_rank,
    CASE
      WHEN ar.e_status IN ('winner','runner_up_1','runner_up_2','special_jury','honourable_mention')
           AND ar.e_placement IS DISTINCT FROM ar.e_status
        THEN 'status_placement_mismatch'
      WHEN ar.e_status = 'winner' AND ar.exp_rank > 1
        THEN 'winner_not_top_ranked'
      WHEN ar.e_status = 'runner_up_1' AND ar.exp_rank > 2
        THEN 'runner_up_1_below_2nd_rank'
      ELSE NULL
    END AS drift_reason
  FROM award_rank ar
  WHERE
    (ar.e_status IN ('winner','runner_up_1','runner_up_2','special_jury','honourable_mention')
     AND ar.e_placement IS DISTINCT FROM ar.e_status)
    OR (ar.e_status = 'winner' AND ar.exp_rank > 1)
    OR (ar.e_status = 'runner_up_1' AND ar.exp_rank > 2);
END;
$function$;