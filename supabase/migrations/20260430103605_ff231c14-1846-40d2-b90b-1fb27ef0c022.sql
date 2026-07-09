-- Phase R2 · Step 2.1b · Close silent-break gap discovered after Step 2.1.
-- Three functions still label-matched on legacy 'shortlist'/'qualified' tokens
-- and silently dropped the 15 R2 rows backfilled to canonical 'qualified_r3'
-- in Step 1.4. Widen them now (read-side only — no writes change).

-- ---------------------------------------------------------------
-- 1) apply_decision_to_remaining: route eligibility through the
--    single source of truth (is_qualifying_decision) instead of
--    the hardcoded IN-list.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_decision_to_remaining(
  _competition_id uuid, _round_number integer, _decision text)
 RETURNS TABLE(inserted_count integer, skipped_existing integer, total_targeted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller            uuid := auth.uid();
  _is_admin          boolean;
  _is_assigned_judge boolean;
  _assignment_mode   text;
  _allowed_decisions text[] := ARRAY[
    'accept','accepted','approved','round1_qualified',
    'reject','rejected',
    'shortlist','shortlisted',
    'qualified_r3','shortlisted_final',           -- canonical v3 (Phase R1)
    'needs_review',
    'finalist','winner','runner_up','third_place','honorable_mention'
  ];
  _assigned_ids      uuid[];
  _ins               integer := 0;
  _tot               integer := 0;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  _is_admin := public.has_role(_caller, 'admin'::app_role);

  SELECT EXISTS (
    SELECT 1 FROM public.competition_judges cj
    WHERE cj.competition_id = _competition_id AND cj.judge_id = _caller
  ) INTO _is_assigned_judge;

  IF NOT (_is_admin OR _is_assigned_judge) THEN
    RAISE EXCEPTION 'Permission denied: not a judge for this competition';
  END IF;

  IF NOT _is_admin AND NOT public.has_role(_caller, 'judge'::app_role) THEN
    RAISE EXCEPTION 'Permission denied: judge role required';
  END IF;

  IF _round_number IS NULL OR _round_number < 1 OR _round_number > 4 THEN
    RAISE EXCEPTION 'Invalid round number: %', _round_number;
  END IF;

  IF _decision IS NULL OR NOT (_decision = ANY(_allowed_decisions)) THEN
    RAISE EXCEPTION 'Invalid decision value: %', _decision;
  END IF;

  SELECT judge_assignment_mode INTO _assignment_mode
  FROM public.competitions WHERE id = _competition_id;

  IF _assignment_mode = 'distributed' AND NOT _is_admin THEN
    SELECT COALESCE(array_agg(entry_id), ARRAY[]::uuid[])
    INTO _assigned_ids
    FROM public.judge_entry_assignments
    WHERE competition_id = _competition_id AND judge_id = _caller;

    IF array_length(_assigned_ids, 1) IS NULL THEN
      inserted_count := 0; skipped_existing := 0; total_targeted := 0;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  WITH eligible_pairs AS (
    SELECT ce.id AS entry_id, gs.idx AS photo_index
    FROM public.competition_entries ce
    CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
    WHERE ce.competition_id = _competition_id
      AND (_assigned_ids IS NULL OR ce.id = ANY(_assigned_ids))
      AND (
        _round_number = 1
        OR EXISTS (
          SELECT 1
          FROM public.judge_decisions jd
          JOIN public.competition_judges cj
            ON cj.judge_id = jd.judge_id
           AND cj.competition_id = _competition_id
          WHERE jd.entry_id     = ce.id
            AND jd.photo_index  = gs.idx
            AND jd.round_number = _round_number - 1
            -- Phase R2 Step 2.1b: route through canonical helper
            AND public.is_qualifying_decision(jd.decision, _round_number - 1)
        )
      )
  ),
  targets AS (
    SELECT ep.entry_id, ep.photo_index
    FROM eligible_pairs ep
    WHERE NOT EXISTS (
      SELECT 1 FROM public.judge_decisions jd
      WHERE jd.entry_id     = ep.entry_id
        AND jd.judge_id     = _caller
        AND jd.round_number = _round_number
        AND jd.photo_index  = ep.photo_index
    )
  ),
  total AS (SELECT COUNT(*)::integer AS n FROM eligible_pairs),
  ins AS (
    INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, decision, photo_index)
    SELECT t.entry_id, _caller, _round_number, _decision, t.photo_index
    FROM targets t
    RETURNING 1
  )
  SELECT (SELECT COUNT(*)::integer FROM ins), (SELECT n FROM total)
    INTO _ins, _tot;

  inserted_count   := COALESCE(_ins, 0);
  total_targeted   := COALESCE(_tot, 0);
  skipped_existing := total_targeted - inserted_count;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------
-- 2) get_per_photo_consensus: add canonical v3 tokens to the
--    R2/R3 status mapping AND priority table so consensus rows
--    backed by 'qualified_r3' / 'shortlisted_final' resolve to the
--    correct user-facing status instead of 'pending_consensus'.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_per_photo_consensus(p_entry_ids uuid[])
 RETURNS TABLE(entry_id uuid, photo_index integer, round_number integer, decision text, judges_decided integer, total_judges integer, ratio numeric, threshold numeric, has_consensus boolean, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_caller IS NOT NULL THEN
    v_is_admin := public.has_role(v_caller, 'admin'::app_role);
  END IF;

  RETURN QUERY
  WITH visible_entries AS (
    SELECT ce.id, ce.competition_id, ce.user_id, ce.judge_assignment_mode_resolved,
      CASE
        WHEN v_is_admin THEN 'admin'
        WHEN v_caller IS NOT NULL AND ce.user_id = v_caller THEN 'owner'
        WHEN v_caller IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.competition_judges cj
          WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller
        ) THEN 'judge'
        ELSE 'public'
      END AS viewer_role
    FROM (
      SELECT e.id, e.competition_id, e.user_id,
             c.judge_assignment_mode AS judge_assignment_mode_resolved
      FROM public.competition_entries e
      JOIN public.competitions c ON c.id = e.competition_id
      WHERE e.id = ANY(p_entry_ids)
    ) ce
    WHERE v_is_admin
       OR (v_caller IS NOT NULL AND ce.user_id = v_caller)
       OR (v_caller IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.competition_judges cj
            WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller))
       OR EXISTS (
            SELECT 1 FROM public.competition_round_publish crp
            WHERE crp.competition_id = ce.competition_id AND crp.published_at IS NOT NULL)
  ),
  decs AS (
    SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index,
           jd.round_number, jd.decision, jd.judge_id
    FROM public.judge_decisions jd
    JOIN visible_entries ve ON ve.id = jd.entry_id
    WHERE ve.viewer_role IN ('admin', 'judge')
       OR EXISTS (
            SELECT 1 FROM public.competition_round_publish crp
            WHERE crp.competition_id = ve.competition_id
              AND crp.round_number = jd.round_number
              AND crp.published_at IS NOT NULL)
  ),
  -- Phase R2 Step 2.1b: include canonical v3 tokens in priority resolution
  priority(decision_key, prio) AS (
    VALUES
      ('shortlisted_final'::text, 65),('shortlist'::text, 60),('shortlisted'::text, 60),
      ('shortlisted_for_final'::text, 60),('shortlisted for final'::text, 60),
      ('qualified_r3'::text, 55),('qualified'::text, 50),('winner'::text, 55),
      ('finalist'::text, 45),('accept'::text, 40),('accepted'::text, 40),
      ('needs_review'::text, 30),('skip'::text, 20),
      ('reject'::text, 10),('rejected'::text, 10)
  ),
  counts AS (
    SELECT d.entry_id, d.photo_index, d.round_number, d.decision, COUNT(*)::int AS n
    FROM decs d
    GROUP BY d.entry_id, d.photo_index, d.round_number, d.decision
  ),
  ranked AS (
    SELECT cnt.entry_id, cnt.photo_index, cnt.round_number, cnt.decision, cnt.n,
           ROW_NUMBER() OVER (
             PARTITION BY cnt.entry_id, cnt.photo_index, cnt.round_number
             ORDER BY cnt.n DESC, COALESCE(p.prio, 0) DESC, cnt.decision ASC
           ) AS rn
    FROM counts cnt LEFT JOIN priority p ON p.decision_key = cnt.decision
  ),
  winners AS (
    SELECT r.entry_id, r.photo_index, r.round_number, r.decision AS win_decision, r.n AS win_count
    FROM ranked r WHERE r.rn = 1
  ),
  judges_for_entry AS (
    SELECT ve.id AS entry_ref,
      CASE WHEN ve.judge_assignment_mode_resolved = 'distributed' THEN
        (SELECT COUNT(*)::int FROM public.judge_entry_assignments jea WHERE jea.entry_id = ve.id)
      ELSE
        (SELECT COUNT(*)::int FROM public.competition_judges cj WHERE cj.competition_id = ve.competition_id)
      END AS total_judges
    FROM visible_entries ve
  ),
  decided_per_photo AS (
    SELECT d.entry_id, d.photo_index, d.round_number,
           COUNT(DISTINCT d.judge_id)::int AS judges_decided
    FROM decs d
    GROUP BY d.entry_id, d.photo_index, d.round_number
  ),
  cfg AS (
    SELECT jc.competition_id, jc.round_number,
           COALESCE(jc.threshold, 0.5) AS threshold,
           COALESCE(jc.min_judges, 1)  AS min_judges
    FROM public.judging_config jc
  ),
  publish_state AS (
    SELECT crp.competition_id, crp.round_number, crp.published_at IS NOT NULL AS is_published
    FROM public.competition_round_publish crp
  )
  SELECT w.entry_id, w.photo_index, w.round_number,
    w.win_decision AS decision,
    dp.judges_decided,
    GREATEST(jfe.total_judges, 1) AS total_judges,
    ROUND((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric, 4) AS ratio,
    COALESCE(cfg.threshold, 0.5) AS threshold,
    ((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(cfg.threshold, 0.5)
      AND dp.judges_decided >= COALESCE(cfg.min_judges, 1)) AS has_consensus,
    CASE
      WHEN ve.viewer_role = 'owner'
       AND COALESCE((SELECT ps.is_published FROM publish_state ps
                     WHERE ps.competition_id = ve.competition_id
                       AND ps.round_number = w.round_number), false) = false
        THEN 'pending_consensus'
      WHEN NOT ((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(cfg.threshold, 0.5)
                AND dp.judges_decided >= COALESCE(cfg.min_judges, 1)) THEN 'pending_consensus'
      WHEN w.round_number = 4 AND w.win_decision = 'winner' THEN 'winner'
      WHEN w.round_number = 4 AND w.win_decision = 'finalist' THEN 'finalist'
      -- Phase R2 Step 2.1b: include canonical v3 'shortlisted_final' on R3
      WHEN w.round_number = 3 AND w.win_decision IN ('shortlisted_final','qualified','shortlist','shortlisted','finalist','shortlisted_for_final','shortlisted for final') THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision IN ('reject','rejected','skip') THEN 'rejected'
      -- Phase R2 Step 2.1b: include canonical v3 'qualified_r3' on R2
      WHEN w.round_number = 2 AND w.win_decision IN ('qualified_r3','shortlist','shortlisted','qualified') THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision IN ('skip','reject','rejected') THEN 'rejected'
      WHEN w.round_number = 1 AND w.win_decision IN ('accept','accepted') THEN 'round1_qualified'
      WHEN w.round_number = 1 AND w.win_decision IN ('shortlist','shortlisted') THEN 'shortlisted'
      WHEN w.round_number = 1 AND w.win_decision = 'needs_review' THEN 'needs_review'
      WHEN w.round_number = 1 AND w.win_decision IN ('reject','rejected') THEN 'rejected'
      ELSE 'pending_consensus'
    END AS status
  FROM winners w
  JOIN visible_entries ve ON ve.id = w.entry_id
  JOIN judges_for_entry jfe ON jfe.entry_ref = w.entry_id
  JOIN decided_per_photo dp ON dp.entry_id = w.entry_id
                           AND dp.photo_index = w.photo_index
                           AND dp.round_number = w.round_number
  LEFT JOIN cfg ON cfg.competition_id = ve.competition_id AND cfg.round_number = w.round_number
  ORDER BY w.entry_id, w.photo_index, w.round_number;
END;
$function$;

-- ---------------------------------------------------------------
-- 3) get_round_summary: add canonical v3 tokens to the qualified
--    counter so the admin "Round Summary" card stops under-counting.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_round_summary(p_competition_id uuid, p_round_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_judge boolean;
  v_round_str text := p_round_number::text;
  v_total int;
  v_qualified int;
  v_rejected int;
  v_needs_review int;
  v_pending int;
  v_top jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT has_role(v_uid, 'admin'::app_role) INTO v_is_admin;
  SELECT has_role(v_uid, 'judge'::app_role) INTO v_is_judge;
  IF NOT (v_is_admin OR v_is_judge) THEN
    RAISE EXCEPTION 'Forbidden: judge or admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(GREATEST(COALESCE(array_length(ce.photos, 1), 0), 1)), 0)
    INTO v_total
  FROM competition_entries ce
  WHERE ce.competition_id = p_competition_id
    AND ce.current_round = v_round_str;

  WITH photo_decisions AS (
    SELECT DISTINCT ON (jd.entry_id, jd.photo_index)
      jd.entry_id, jd.photo_index, jd.decision
    FROM judge_decisions jd
    JOIN competition_entries ce ON ce.id = jd.entry_id
    WHERE ce.competition_id = p_competition_id
      AND ce.current_round = v_round_str
      AND jd.round_number = p_round_number
    ORDER BY jd.entry_id, jd.photo_index, jd.updated_at DESC NULLS LAST, jd.judge_id
  )
  SELECT
    -- Phase R2 Step 2.1b: include canonical v3 tokens in qualified count
    COUNT(*) FILTER (WHERE decision IN (
      'accept','accepted','shortlist','shortlisted',
      'qualified_r3','shortlisted_final',
      'round1_qualified','round2_qualified','finalist','winner'
    )),
    COUNT(*) FILTER (WHERE decision IN ('reject','rejected')),
    COUNT(*) FILTER (WHERE decision = 'needs_review')
  INTO v_qualified, v_rejected, v_needs_review
  FROM photo_decisions;

  v_pending := GREATEST(0, v_total - v_qualified - v_rejected - v_needs_review);

  WITH photo_scores AS (
    SELECT js.entry_id, js.photo_index, AVG(js.score)::numeric AS avg_score
    FROM judge_scores js
    JOIN competition_entries ce ON ce.id = js.entry_id
    WHERE ce.competition_id = p_competition_id
      AND ce.current_round = v_round_str
      AND js.score IS NOT NULL
    GROUP BY js.entry_id, js.photo_index
  ),
  photo_latest_decisions AS (
    SELECT DISTINCT ON (jd.entry_id, jd.photo_index)
      jd.entry_id, jd.photo_index, jd.decision
    FROM judge_decisions jd
    JOIN competition_entries ce ON ce.id = jd.entry_id
    WHERE ce.competition_id = p_competition_id
      AND ce.current_round = v_round_str
      AND jd.round_number = p_round_number
    ORDER BY jd.entry_id, jd.photo_index, jd.updated_at DESC NULLS LAST, jd.judge_id
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.avg_score DESC NULLS LAST), '[]'::jsonb)
  INTO v_top
  FROM (
    SELECT ce.id,
      (ce.title || ' (Image ' || (ps.photo_index + 1)::text || ')') AS title,
      COALESCE(pld.decision, 'pending') AS status,
      (CASE
        WHEN COALESCE(array_length(ce.photo_thumbnails, 1), 0) > ps.photo_index
          THEN ce.photo_thumbnails[ps.photo_index + 1]
        WHEN COALESCE(array_length(ce.photos, 1), 0) > ps.photo_index
          THEN ce.photos[ps.photo_index + 1]
        ELSE NULL
      END) AS thumbnail,
      ps.avg_score
    FROM photo_scores ps
    JOIN competition_entries ce ON ce.id = ps.entry_id
    LEFT JOIN photo_latest_decisions pld
      ON pld.entry_id = ps.entry_id AND pld.photo_index = ps.photo_index
    ORDER BY ps.avg_score DESC NULLS LAST
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'qualified', v_qualified,
    'rejected', v_rejected,
    'needs_review', v_needs_review,
    'pending', v_pending,
    'top_entries', v_top
  );
END;
$function$;