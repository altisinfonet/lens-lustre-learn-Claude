
-- 1. Insert two new stage catalog rows (idempotent)
INSERT INTO public.v3_stage_catalog
  (stage_key, round_number, family, decision_token, tag_label_canonical,
   advances_to_round, blocks_from_round, description, cert_eligible, is_active)
VALUES
  ('r2_accepted', 2, 'progression_pass', 'accept', 'Accepted',
   3, NULL, 'Round 2 photo accepted by judge consensus — advances to Round 3.', true, true),
  ('r3_accepted', 3, 'progression_pass', 'accept', 'Accepted',
   4, NULL, 'Round 3 photo accepted by judge consensus — advances to Round 4.', true, true)
ON CONFLICT (stage_key) DO NOTHING;

-- 2. Insert two new judging_tags (idempotent via NOT EXISTS guard)
INSERT INTO public.judging_tags
  (label, color, sort_order, is_active, is_system, is_visible, visible_in_round, icon, created_by)
SELECT 'Accepted', '#06b6d4', 50, true, true, true, ARRAY[2]::int[], 'check-circle',
       '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM public.judging_tags
   WHERE label = 'Accepted' AND visible_in_round = ARRAY[2]::int[]
);

INSERT INTO public.judging_tags
  (label, color, sort_order, is_active, is_system, is_visible, visible_in_round, icon, created_by)
SELECT 'Accepted', '#06b6d4', 50, true, true, true, ARRAY[3]::int[], 'check-circle',
       '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM public.judging_tags
   WHERE label = 'Accepted' AND visible_in_round = ARRAY[3]::int[]
);

-- 3. Rewrite get_per_photo_consensus with qualified-beats-accepted tie-break
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
  -- Path B: qualified_r3 (70) and shortlisted_final (65) outrank accept (40)
  -- so on tie counts, "Qualified" beats "Accepted".
  priority(decision_key, prio) AS (
    VALUES
      ('qualified_r3'::text, 70),
      ('shortlisted_final'::text, 65),
      ('shortlist'::text, 60),('shortlisted'::text, 60),
      ('shortlisted_for_final'::text, 60),('shortlisted for final'::text, 60),
      ('qualified'::text, 50),('winner'::text, 55),
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
      -- R3: shortlisted_final / qualified / accept all advance to finalist
      WHEN w.round_number = 3 AND w.win_decision IN ('shortlisted_final','qualified','shortlist','shortlisted','finalist','shortlisted_for_final','shortlisted for final','accept','accepted') THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision IN ('reject','rejected','skip','not_selected_final') THEN 'rejected'
      -- R2: qualified_r3 / qualified / accept all advance to round2_qualified
      WHEN w.round_number = 2 AND w.win_decision IN ('qualified_r3','shortlist','shortlisted','qualified','accept','accepted') THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision IN ('skip','reject','rejected','not_selected_r3') THEN 'rejected'
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
