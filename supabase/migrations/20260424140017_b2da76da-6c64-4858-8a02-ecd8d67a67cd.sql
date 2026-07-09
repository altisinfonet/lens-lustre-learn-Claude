CREATE OR REPLACE FUNCTION public.auto_tier_judge_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _round_text text;
  _round_number integer;
  _criteria_values numeric[];
  _criteria_count integer;
  _criteria_sum numeric;
  _avg numeric;
  _decision text;
BEGIN
  SELECT c.current_round
    INTO _round_text
  FROM public.competition_entries ce
  JOIN public.competitions c ON c.id = ce.competition_id
  WHERE ce.id = NEW.entry_id;

  _round_number := NULLIF(regexp_replace(COALESCE(_round_text, ''), '\D', '', 'g'), '')::integer;

  IF _round_number IS NULL OR _round_number < 2 OR _round_number > 4 THEN
    RETURN NEW;
  END IF;

  _criteria_values := ARRAY[
    NEW.line_score, NEW.shape_score, NEW.form_score,
    NEW.texture_score, NEW.color_palette_score, NEW.space_score,
    NEW.tone_score, NEW.balance_score, NEW.light_score, NEW.depth_score
  ]::numeric[];

  SELECT COUNT(v), COALESCE(SUM(v), 0)
    INTO _criteria_count, _criteria_sum
  FROM unnest(_criteria_values) AS v
  WHERE v IS NOT NULL;

  IF _criteria_count = 0 THEN
    _avg := 0;
  ELSE
    _avg := _criteria_sum / _criteria_count;
  END IF;

  _decision := public.derive_decision_from_score(_avg, _round_number);

  IF _decision IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.judge_decisions
    (entry_id, judge_id, round_number, decision, photo_index)
  VALUES
    (NEW.entry_id, NEW.judge_id, _round_number, _decision, COALESCE(NEW.photo_index, 0))
  ON CONFLICT (entry_id, judge_id, round_number, photo_index)
  DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_per_photo_consensus(p_entry_ids uuid[])
RETURNS TABLE(entry_id uuid, photo_index integer, round_number integer, decision text, judges_decided integer, total_judges integer, ratio numeric, threshold numeric, has_consensus boolean, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  v_is_admin := public.has_role(v_caller, 'admin'::app_role)
             OR public.has_role(v_caller, 'super_admin'::app_role);

  RETURN QUERY
  WITH
  visible_entries AS (
    SELECT
      ce.id,
      ce.competition_id,
      ce.user_id,
      ce.judge_assignment_mode_resolved,
      CASE
        WHEN v_is_admin THEN 'admin'
        WHEN ce.user_id = v_caller THEN 'owner'
        ELSE 'judge'
      END AS viewer_role
    FROM (
      SELECT
        e.id, e.competition_id, e.user_id,
        c.judge_assignment_mode AS judge_assignment_mode_resolved
      FROM public.competition_entries e
      JOIN public.competitions c ON c.id = e.competition_id
      WHERE e.id = ANY(p_entry_ids)
    ) ce
    WHERE
      v_is_admin
      OR ce.user_id = v_caller
      OR EXISTS (
        SELECT 1 FROM public.competition_judges cj
        WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller
      )
  ),
  explicit_decs AS (
    SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index, jd.round_number, jd.decision, jd.judge_id
    FROM public.judge_decisions jd
    JOIN visible_entries ve ON ve.id = jd.entry_id
  ),
  round1_tag_decs AS (
    SELECT
      jta.entry_id,
      COALESCE(jta.photo_index, 0) AS photo_index,
      1 AS round_number,
      CASE lower(trim(jt.label))
        WHEN 'accepted' THEN 'accept'
        WHEN 'qualified for 2nd round' THEN 'shortlist'
        WHEN 'rejected' THEN 'reject'
        WHEN 'verification required - round 1' THEN 'needs_review'
        ELSE NULL
      END AS decision,
      jta.judge_id
    FROM public.judge_tag_assignments jta
    JOIN public.judging_tags jt ON jt.id = jta.tag_id
    JOIN visible_entries ve ON ve.id = jta.entry_id
    LEFT JOIN explicit_decs ed
      ON ed.entry_id = jta.entry_id
     AND ed.photo_index = COALESCE(jta.photo_index, 0)
     AND ed.round_number = 1
     AND ed.judge_id = jta.judge_id
    WHERE ed.entry_id IS NULL
      AND lower(trim(jt.label)) IN (
        'accepted',
        'qualified for 2nd round',
        'rejected',
        'verification required - round 1'
      )
      AND (
        jt.visible_in_round IS NULL
        OR cardinality(jt.visible_in_round) = 0
        OR 1 = ANY(jt.visible_in_round)
      )
  ),
  decs AS (
    SELECT * FROM explicit_decs
    UNION ALL
    SELECT entry_id, photo_index, round_number, decision, judge_id
    FROM round1_tag_decs
    WHERE decision IS NOT NULL
  ),
  priority(decision, prio) AS (
    VALUES
      ('shortlist'::text,   60),
      ('shortlisted'::text, 60),
      ('qualified'::text,   50),
      ('winner'::text,      55),
      ('finalist'::text,    45),
      ('accept'::text,      40),
      ('needs_review'::text,30),
      ('skip'::text,        20),
      ('reject'::text,      10),
      ('rejected'::text,    10)
  ),
  counts AS (
    SELECT entry_id, photo_index, round_number, decision, COUNT(*)::int AS n
    FROM decs
    GROUP BY entry_id, photo_index, round_number, decision
  ),
  ranked AS (
    SELECT
      c.entry_id, c.photo_index, c.round_number, c.decision, c.n,
      ROW_NUMBER() OVER (
        PARTITION BY c.entry_id, c.photo_index, c.round_number
        ORDER BY c.n DESC, COALESCE(p.prio, 0) DESC, c.decision ASC
      ) AS rn
    FROM counts c
    LEFT JOIN priority p ON p.decision = c.decision
  ),
  winners AS (
    SELECT entry_id, photo_index, round_number, decision AS win_decision, n AS win_count
    FROM ranked WHERE rn = 1
  ),
  judges_for_entry AS (
    SELECT
      ve.id AS entry_id,
      CASE
        WHEN ve.judge_assignment_mode_resolved = 'distributed' THEN
          (SELECT COUNT(*)::int FROM public.judge_entry_assignments jea
            WHERE jea.entry_id = ve.id)
        ELSE
          (SELECT COUNT(*)::int FROM public.competition_judges cj
            WHERE cj.competition_id = ve.competition_id)
      END AS total_judges
    FROM visible_entries ve
  ),
  decided_per_photo AS (
    SELECT entry_id, photo_index, round_number,
           COUNT(DISTINCT judge_id)::int AS judges_decided
    FROM decs
    GROUP BY entry_id, photo_index, round_number
  ),
  cfg AS (
    SELECT competition_id, round_number,
           COALESCE(threshold, 0.5)  AS threshold,
           COALESCE(min_judges, 1)   AS min_judges
    FROM public.judging_config
  ),
  publish_state AS (
    SELECT competition_id, round_number, published_at IS NOT NULL AS is_published
    FROM public.competition_round_publish
  )
  SELECT
    w.entry_id,
    w.photo_index,
    w.round_number,
    w.win_decision AS decision,
    dp.judges_decided,
    GREATEST(jfe.total_judges, 1) AS total_judges,
    ROUND((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric, 4) AS ratio,
    COALESCE(c.threshold, 0.5) AS threshold,
    (
      (w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(c.threshold, 0.5)
      AND dp.judges_decided >= COALESCE(c.min_judges, 1)
    ) AS has_consensus,
    CASE
      WHEN ve.viewer_role = 'owner'
       AND COALESCE((SELECT ps.is_published FROM publish_state ps
                     WHERE ps.competition_id = ve.competition_id
                       AND ps.round_number = w.round_number), false) = false
        THEN 'pending_consensus'
      WHEN NOT (
        (w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(c.threshold, 0.5)
        AND dp.judges_decided >= COALESCE(c.min_judges, 1)
      ) THEN 'pending_consensus'
      WHEN w.round_number = 4 AND w.win_decision = 'winner' THEN 'winner'
      WHEN w.round_number = 4 AND w.win_decision = 'finalist' THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision = 'qualified' THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision IN ('reject','rejected') THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision = 'shortlist' THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision IN ('skip','reject','rejected') THEN 'rejected'
      WHEN w.round_number = 2 AND w.win_decision = 'needs_review' THEN 'needs_review'
      WHEN w.round_number = 2 AND w.win_decision = 'qualified' THEN 'round2_qualified'
      WHEN w.round_number = 1 AND w.win_decision = 'accept' THEN 'round1_qualified'
      WHEN w.round_number = 1 AND w.win_decision = 'shortlist' THEN 'shortlisted'
      WHEN w.round_number = 1 AND w.win_decision = 'needs_review' THEN 'needs_review'
      WHEN w.round_number = 1 AND w.win_decision IN ('reject','rejected') THEN 'rejected'
      ELSE 'pending_consensus'
    END AS status
  FROM winners w
  JOIN visible_entries ve ON ve.id = w.entry_id
  JOIN judges_for_entry jfe ON jfe.entry_id = w.entry_id
  JOIN decided_per_photo dp ON dp.entry_id = w.entry_id
                           AND dp.photo_index = w.photo_index
                           AND dp.round_number = w.round_number
  LEFT JOIN cfg c ON c.competition_id = ve.competition_id AND c.round_number = w.round_number
  ORDER BY w.entry_id, w.photo_index, w.round_number;
END;
$function$;