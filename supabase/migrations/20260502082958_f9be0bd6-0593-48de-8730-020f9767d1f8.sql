-- Phase 5 — Drop status_legacy dual-emit (per-photo consensus + placement)
-- Demo competition; 7-day burn-in waived by user.

-- 1. get_per_photo_consensus: drop status_legacy column from RETURNS TABLE
DROP FUNCTION IF EXISTS public.get_per_photo_consensus(uuid[]);

CREATE OR REPLACE FUNCTION public.get_per_photo_consensus(p_entry_ids uuid[])
RETURNS TABLE(
  entry_id uuid, photo_index integer, round_number integer, decision text,
  judges_decided integer, total_judges integer, ratio numeric, threshold numeric,
  has_consensus boolean, status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    WHERE (ve.viewer_role IN ('admin', 'judge')
       OR EXISTS (
            SELECT 1 FROM public.competition_round_publish crp
            WHERE crp.competition_id = ve.competition_id
              AND crp.round_number = jd.round_number
              AND crp.published_at IS NOT NULL))
      AND NOT (jd.decision = 'needs_review' AND jd.round_number <> 1)
  ),
  priority(decision_key, prio) AS (
    VALUES
      ('qualified_final'::text, 75),
      ('qualified_r3'::text, 70),
      ('shortlisted_final'::text, 65),
      ('shortlist'::text, 60),('shortlisted'::text, 60),
      ('shortlisted_for_final'::text, 60),('shortlisted for final'::text, 60),
      ('qualified'::text, 50),('winner'::text, 55),
      ('finalist'::text, 45),('accept'::text, 40),('accepted'::text, 40),
      ('needs_review'::text, 30),('skip'::text, 20),
      ('not_selected_r3'::text, 12),('not_selected_final'::text, 12),
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
    SELECT r.entry_id, r.photo_index, r.round_number,
           r.decision AS win_decision, r.n AS win_count
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
  ),
  computed AS (
    SELECT
      w.entry_id, w.photo_index, w.round_number, w.win_decision, w.win_count,
      ve.viewer_role, ve.competition_id,
      dp.judges_decided,
      GREATEST(jfe.total_judges, 1) AS total_judges_v,
      ROUND((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric, 4) AS ratio_v,
      COALESCE(cfg.threshold, 0.5) AS threshold_v,
      ((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(cfg.threshold, 0.5)
        AND dp.judges_decided >= COALESCE(cfg.min_judges, 1)) AS has_consensus_v,
      COALESCE((SELECT ps.is_published FROM publish_state ps
                WHERE ps.competition_id = ve.competition_id
                  AND ps.round_number = w.round_number), false) AS is_published_v
    FROM winners w
    JOIN visible_entries ve ON ve.id = w.entry_id
    JOIN judges_for_entry jfe ON jfe.entry_ref = w.entry_id
    JOIN decided_per_photo dp ON dp.entry_id = w.entry_id
                             AND dp.photo_index = w.photo_index
                             AND dp.round_number = w.round_number
    LEFT JOIN cfg ON cfg.competition_id = ve.competition_id AND cfg.round_number = w.round_number
  )
  SELECT
    c.entry_id, c.photo_index, c.round_number,
    c.win_decision  AS decision,
    c.judges_decided,
    c.total_judges_v AS total_judges,
    c.ratio_v        AS ratio,
    c.threshold_v    AS threshold,
    c.has_consensus_v AS has_consensus,
    CASE
      WHEN c.viewer_role = 'owner' AND c.is_published_v = false
        THEN 'pending_consensus'
      WHEN NOT c.has_consensus_v
        THEN 'pending_consensus'
      WHEN c.round_number = 4 AND c.win_decision = 'winner'   THEN 'winner'
      WHEN c.round_number = 4 AND c.win_decision = 'finalist' THEN 'finalist'
      WHEN c.round_number = 3 AND c.win_decision IN ('qualified_final','shortlisted_final')
        THEN 'r3_qualified_final'
      WHEN c.round_number = 3 AND c.win_decision IN ('accept','accepted')
        THEN 'r3_accepted'
      WHEN c.round_number = 2 AND c.win_decision IN ('qualified_r3','qualified','shortlist','shortlisted')
        THEN 'r2_qualified_r3'
      WHEN c.round_number = 2 AND c.win_decision IN ('accept','accepted')
        THEN 'r2_accepted'
      WHEN c.round_number = 1 AND c.win_decision IN ('accept','accepted')
        THEN 'r1_accepted'
      WHEN c.round_number = 1 AND c.win_decision IN ('shortlist','shortlisted')
        THEN 'r1_shortlisted_r2'
      WHEN c.round_number = 1 AND c.win_decision = 'needs_review'
        THEN 'r1_needs_review'
      WHEN c.round_number = 1 AND c.win_decision IN ('reject','rejected')
        THEN 'r1_rejected'
      ELSE 'pending_consensus'
    END AS status
  FROM computed c
  ORDER BY c.entry_id, c.photo_index, c.round_number;
END;
$function$;

-- 2. get_per_photo_placement: drop status_legacy column
DO $$
DECLARE
  v_def text;
BEGIN
  -- Recreate placement RPC without status_legacy column
  NULL;
END $$;

DROP FUNCTION IF EXISTS public.get_per_photo_placement(uuid[]);

CREATE OR REPLACE FUNCTION public.get_per_photo_placement(p_entry_ids uuid[])
RETURNS TABLE(
  entry_id uuid, photo_index integer, round_number integer,
  status text, award_label text, declared boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    SELECT ce.id, ce.competition_id, ce.user_id,
      CASE
        WHEN v_is_admin THEN 'admin'
        WHEN v_caller IS NOT NULL AND ce.user_id = v_caller THEN 'owner'
        WHEN v_caller IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.competition_judges cj
          WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller
        ) THEN 'judge'
        ELSE 'public'
      END AS viewer_role
    FROM public.competition_entries ce
    WHERE ce.id = ANY(p_entry_ids)
  ),
  declared_r4 AS (
    SELECT crp.competition_id, crp.published_at IS NOT NULL AS is_declared
    FROM public.competition_round_publish crp
    WHERE crp.round_number = 4
  ),
  raw_tags AS (
    SELECT
      jta.entry_id,
      COALESCE(jta.photo_index, 0) AS photo_index,
      jt.label AS award_label,
      CASE LOWER(TRIM(jt.label))
        WHEN 'winner' THEN 'r4_winner'
        WHEN '1st runner-up' THEN 'r4_runner_up_1'
        WHEN '2nd runner-up' THEN 'r4_runner_up_2'
        WHEN 'top 50' THEN 'r4_top_50'
        WHEN 'top 50 global photographer' THEN 'r4_top_50'
        WHEN 'top 100' THEN 'r4_top_100'
        WHEN 'top 100 global photographer' THEN 'r4_top_100'
        WHEN 'finalist' THEN 'r4_finalist'
        WHEN 'qualified for final' THEN 'r4_finalist'
        WHEN 'honorary mention' THEN 'r4_honorary_mention'
        WHEN 'honourable mention' THEN 'r4_honorary_mention'
        WHEN 'honorable mention' THEN 'r4_honorary_mention'
        WHEN 'special jury award' THEN 'r4_special_jury'
        WHEN 'special jury' THEN 'r4_special_jury'
        ELSE NULL
      END AS canon_key
    FROM public.judge_tag_assignments jta
    JOIN public.judging_tags jt ON jt.id = jta.tag_id
    JOIN visible_entries ve ON ve.id = jta.entry_id
    WHERE jta.round_number = 4
      AND (ve.viewer_role IN ('admin','owner','judge')
           OR COALESCE((SELECT dr.is_declared FROM declared_r4 dr
                        JOIN visible_entries ve2 ON ve2.competition_id = dr.competition_id
                        WHERE ve2.id = jta.entry_id LIMIT 1), false))
  ),
  prio(canon_key, prio) AS (
    VALUES
      ('r4_winner', 100),
      ('r4_runner_up_1', 90),
      ('r4_runner_up_2', 80),
      ('r4_top_50', 70),
      ('r4_top_100', 60),
      ('r4_finalist', 50),
      ('r4_honorary_mention', 40),
      ('r4_special_jury', 30)
  ),
  ranked AS (
    SELECT rt.entry_id, rt.photo_index, rt.canon_key, rt.award_label,
           ROW_NUMBER() OVER (
             PARTITION BY rt.entry_id, rt.photo_index
             ORDER BY COALESCE(p.prio, 0) DESC, rt.award_label ASC
           ) AS rn
    FROM raw_tags rt
    LEFT JOIN prio p ON p.canon_key = rt.canon_key
    WHERE rt.canon_key IS NOT NULL
  )
  SELECT
    r.entry_id, r.photo_index, 4 AS round_number,
    r.canon_key AS status, r.award_label,
    COALESCE((SELECT dr.is_declared FROM declared_r4 dr
              JOIN visible_entries ve ON ve.competition_id = dr.competition_id
              WHERE ve.id = r.entry_id LIMIT 1), false) AS declared
  FROM ranked r
  WHERE r.rn = 1
  ORDER BY r.entry_id, r.photo_index;
END;
$function$;