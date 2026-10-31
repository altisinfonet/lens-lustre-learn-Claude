-- =========================================================================
-- Restrict 'Needs Review' decisions to Round 1 only (Spec V3 hard-guard)
-- =========================================================================

-- 1) Hard-reject any judge_decisions write where decision='needs_review'
--    AND round_number > 1. R1 still allowed (mandatory).
CREATE OR REPLACE FUNCTION public.guard_needs_review_round1_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.decision = 'needs_review' AND COALESCE(NEW.round_number, 0) <> 1 THEN
    RAISE EXCEPTION
      '"Needs Review" decisions are only permitted in Round 1 (Spec V3). Got round_number=%',
      NEW.round_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_needs_review_round1_only ON public.judge_decisions;
CREATE TRIGGER trg_guard_needs_review_round1_only
BEFORE INSERT OR UPDATE OF decision, round_number ON public.judge_decisions
FOR EACH ROW
EXECUTE FUNCTION public.guard_needs_review_round1_only();

-- 2) Clean up the 1 known legacy R2 needs_review row (per audit).
DELETE FROM public.judge_decisions
WHERE decision = 'needs_review' AND round_number <> 1;

-- 3) Restrict get_needs_review_recipients_for_round to R1 only.
--    R2/R3/R4 callers (e.g. publish-round) will get an empty set even if
--    the gate above is bypassed in code.
CREATE OR REPLACE FUNCTION public.get_needs_review_recipients_for_round(
  p_competition_id uuid,
  p_round_number integer
)
RETURNS TABLE(entry_id uuid, user_id uuid, competition_title text, photo_indices integer[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH nr AS (
    SELECT DISTINCT jd.entry_id, jd.photo_index
    FROM public.judge_decisions jd
    WHERE jd.round_number = p_round_number
      AND p_round_number = 1   -- Spec V3: NR only exists in R1
      AND jd.decision = 'needs_review'
      AND jd.entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id = p_competition_id)
  )
  SELECT e.id, e.user_id, c.title,
         array_agg(DISTINCT nr.photo_index ORDER BY nr.photo_index)
  FROM nr
  JOIN public.competition_entries e ON e.id = nr.entry_id
  JOIN public.competitions c ON c.id = e.competition_id
  GROUP BY e.id, e.user_id, c.title;
$$;

-- 4) Update get_per_photo_consensus to never emit 'needs_review' for R2+.
--    Rebuild whole function (other branches unchanged).
CREATE OR REPLACE FUNCTION public.get_per_photo_consensus(p_entry_ids uuid[])
RETURNS TABLE(entry_id uuid, photo_index integer, round_number integer, decision text, judges_decided integer, total_judges integer, ratio numeric, threshold numeric, has_consensus boolean, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;

  v_is_admin := public.has_role(v_caller, 'admin'::app_role)
             OR public.has_role(v_caller, 'super_admin'::app_role);

  RETURN QUERY
  WITH visible_entries AS (
    SELECT
      ce.id, ce.competition_id, ce.user_id,
      ce.judge_assignment_mode_resolved,
      CASE WHEN v_is_admin THEN 'admin'
           WHEN ce.user_id = v_caller THEN 'owner'
           ELSE 'judge' END AS viewer_role
    FROM (
      SELECT e.id, e.competition_id, e.user_id,
             c.judge_assignment_mode AS judge_assignment_mode_resolved
      FROM public.competition_entries e
      JOIN public.competitions c ON c.id = e.competition_id
      WHERE e.id = ANY(p_entry_ids)
    ) ce
    WHERE v_is_admin
       OR ce.user_id = v_caller
       OR EXISTS (SELECT 1 FROM public.competition_judges cj
                  WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller)
  ),
  decs AS (
    SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index,
           jd.round_number, jd.decision, jd.judge_id
    FROM public.judge_decisions jd
    JOIN visible_entries ve ON ve.id = jd.entry_id
  ),
  priority(decision, prio) AS (
    VALUES
      ('shortlist'::text,   60),('shortlisted'::text, 60),
      ('qualified'::text,   50),('winner'::text,      55),
      ('finalist'::text,    45),('accept'::text,      40),
      ('needs_review'::text,30),('skip'::text,        20),
      ('reject'::text,      10),('rejected'::text,    10)
  ),
  counts AS (
    SELECT entry_id, photo_index, round_number, decision, COUNT(*)::int AS n
    FROM decs GROUP BY entry_id, photo_index, round_number, decision
  ),
  ranked AS (
    SELECT c.entry_id, c.photo_index, c.round_number, c.decision, c.n,
           ROW_NUMBER() OVER (
             PARTITION BY c.entry_id, c.photo_index, c.round_number
             ORDER BY c.n DESC, COALESCE(p.prio, 0) DESC, c.decision ASC
           ) AS rn
    FROM counts c LEFT JOIN priority p ON p.decision = c.decision
  ),
  winners AS (
    SELECT entry_id, photo_index, round_number, decision AS win_decision, n AS win_count
    FROM ranked WHERE rn = 1
  ),
  judges_for_entry AS (
    SELECT ve.id AS entry_id,
      CASE WHEN ve.judge_assignment_mode_resolved = 'distributed' THEN
        (SELECT COUNT(*)::int FROM public.judge_entry_assignments jea WHERE jea.entry_id = ve.id)
      ELSE
        (SELECT COUNT(*)::int FROM public.competition_judges cj WHERE cj.competition_id = ve.competition_id)
      END AS total_judges
    FROM visible_entries ve
  ),
  decided_per_photo AS (
    SELECT entry_id, photo_index, round_number,
           COUNT(DISTINCT judge_id)::int AS judges_decided
    FROM decs GROUP BY entry_id, photo_index, round_number
  ),
  cfg AS (
    SELECT competition_id, round_number,
           COALESCE(threshold, 0.5) AS threshold,
           COALESCE(min_judges, 1)  AS min_judges
    FROM public.judging_config
  ),
  publish_state AS (
    SELECT competition_id, round_number, published_at IS NOT NULL AS is_published
    FROM public.competition_round_publish
  )
  SELECT w.entry_id, w.photo_index, w.round_number,
    w.win_decision AS decision,
    dp.judges_decided,
    GREATEST(jfe.total_judges, 1) AS total_judges,
    ROUND((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric, 4) AS ratio,
    COALESCE(c.threshold, 0.5) AS threshold,
    ((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(c.threshold, 0.5)
      AND dp.judges_decided >= COALESCE(c.min_judges, 1)) AS has_consensus,
    CASE
      WHEN ve.viewer_role = 'owner'
       AND COALESCE((SELECT ps.is_published FROM publish_state ps
                     WHERE ps.competition_id = ve.competition_id
                       AND ps.round_number = w.round_number), false) = false
        THEN 'pending_consensus'
      WHEN NOT ((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(c.threshold, 0.5)
                AND dp.judges_decided >= COALESCE(c.min_judges, 1)) THEN 'pending_consensus'
      WHEN w.round_number = 4 AND w.win_decision = 'winner' THEN 'winner'
      WHEN w.round_number = 4 AND w.win_decision = 'finalist' THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision = 'qualified' THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision IN ('reject','rejected') THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision IN ('shortlist','shortlisted','qualified') THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision IN ('skip','reject','rejected') THEN 'rejected'
      -- Spec V3: 'needs_review' is no longer a valid R2 outcome — fall through to pending_consensus
      WHEN w.round_number = 1 AND w.win_decision IN ('accept','accepted') THEN 'round1_qualified'
      WHEN w.round_number = 1 AND w.win_decision IN ('shortlist','shortlisted') THEN 'shortlisted'
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
$$;