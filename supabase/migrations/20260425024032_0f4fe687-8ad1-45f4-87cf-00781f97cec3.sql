CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(_competition_id uuid, _round_number integer)
 RETURNS TABLE(entry_id uuid, photo_index integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH explicit_prior AS (
    SELECT
      jd.entry_id,
      COALESCE(jd.photo_index, 0) AS photo_index,
      jd.round_number,
      jd.decision
    FROM public.judge_decisions jd
    JOIN public.competition_judges cj
      ON cj.judge_id = jd.judge_id
     AND cj.competition_id = _competition_id
  ),
  -- Generic per-round qualification tag fallback.
  -- Maps the "Qualified for Nth Round" / "Qualified for Final Round" tags
  -- (visible in the previous round) into virtual shortlist decisions so that
  -- judges using only the tagging UI still advance photos to the next round.
  --   R1 -> R2 : "Qualified for 2nd Round"      (visible_in_round = {1})
  --   R2 -> R3 : "Qualified for 3rd Round"      (visible_in_round = {2})
  --   R3 -> R4 : "Qualified for Final Round"    (visible_in_round = {3})
  tag_prior AS (
    SELECT
      jta.entry_id,
      COALESCE(jta.photo_index, 0) AS photo_index,
      (_round_number - 1) AS round_number,
      'shortlist'::text AS decision
    FROM public.judge_tag_assignments jta
    JOIN public.judging_tags jt
      ON jt.id = jta.tag_id
    JOIN public.competition_entries ce
      ON ce.id = jta.entry_id
    LEFT JOIN explicit_prior ep
      ON ep.entry_id = jta.entry_id
     AND ep.photo_index = COALESCE(jta.photo_index, 0)
     AND ep.round_number = (_round_number - 1)
     AND ep.decision IN ('shortlist', 'shortlisted')
    WHERE ce.competition_id = _competition_id
      AND _round_number >= 2
      AND lower(trim(jt.label)) = CASE _round_number
            WHEN 2 THEN 'qualified for 2nd round'
            WHEN 3 THEN 'qualified for 3rd round'
            WHEN 4 THEN 'qualified for final round'
            ELSE NULL
          END
      AND (
        jt.visible_in_round IS NULL
        OR cardinality(jt.visible_in_round) = 0
        OR (_round_number - 1) = ANY(jt.visible_in_round)
      )
      AND ep.entry_id IS NULL
  ),
  eligible_prior AS (
    SELECT entry_id, photo_index, round_number
    FROM explicit_prior
    WHERE decision IN ('shortlist', 'shortlisted')

    UNION

    SELECT entry_id, photo_index, round_number
    FROM tag_prior
  )
  SELECT ce.id AS entry_id, gs.idx AS photo_index
  FROM public.competition_entries ce
  CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
  WHERE ce.competition_id = _competition_id
    AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
    AND (
      _round_number = 1
      OR EXISTS (
        SELECT 1
        FROM eligible_prior ep
        WHERE ep.entry_id = ce.id
          AND ep.photo_index = gs.idx
          AND ep.round_number = _round_number - 1
      )
    );
$function$;