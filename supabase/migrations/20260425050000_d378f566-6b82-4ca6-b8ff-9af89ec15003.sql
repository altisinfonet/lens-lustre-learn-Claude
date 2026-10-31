-- ============================================================
-- Phase R2 — FIX: Single source of truth for round eligibility
-- ============================================================
-- Goal: After R1 (mirror trigger + backfill), judge_decisions is the
-- ONLY truth. Rip out the brittle string-matching tag fallbacks from
-- get_round_eligible_photos and get_per_photo_consensus, add a single
-- helper for "is this decision qualifying", and normalize current_round
-- writes to canonical '1'..'4' via a BEFORE trigger (column stays TEXT
-- to preserve compatibility with ~20+ TS callers).
-- ============================================================

-- 1) Helper: extract integer round from any text format ('round2','r3','4')
CREATE OR REPLACE FUNCTION public.current_round_int(_text text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _text IS NULL OR _text = '' THEN NULL
    ELSE NULLIF(regexp_replace(_text, '\D', '', 'g'), '')::int
  END;
$$;

-- 2) Helper: single rule for "decision qualifies photo to advance to round N+1"
--    Used by every eligibility/coverage view. SOW-aligned vocabulary.
CREATE OR REPLACE FUNCTION public.is_qualifying_decision(_decision text, _from_round integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _decision IS NULL THEN false
    WHEN _from_round = 1 THEN lower(_decision) IN ('accept','accepted','shortlist','shortlisted','qualified')
    WHEN _from_round = 2 THEN lower(_decision) IN ('shortlist','shortlisted','qualified')
    WHEN _from_round = 3 THEN lower(_decision) IN ('qualified','shortlist','shortlisted','finalist')
    ELSE false
  END;
$$;

-- 3) Normalize current_round on write (defense-in-depth; column stays TEXT)
CREATE OR REPLACE FUNCTION public.normalize_current_round()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_int int;
BEGIN
  IF NEW.current_round IS NULL OR NEW.current_round = '' THEN
    RETURN NEW;
  END IF;
  v_int := public.current_round_int(NEW.current_round);
  IF v_int IS NULL OR v_int < 1 OR v_int > 4 THEN
    RAISE EXCEPTION 'Invalid current_round value: % (must resolve to 1..4)', NEW.current_round;
  END IF;
  NEW.current_round := v_int::text;  -- canonical '1'..'4'
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_current_round_entries ON public.competition_entries;
CREATE TRIGGER trg_normalize_current_round_entries
BEFORE INSERT OR UPDATE OF current_round ON public.competition_entries
FOR EACH ROW EXECUTE FUNCTION public.normalize_current_round();

DROP TRIGGER IF EXISTS trg_normalize_current_round_competitions ON public.competitions;
CREATE TRIGGER trg_normalize_current_round_competitions
BEFORE INSERT OR UPDATE OF current_round ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.normalize_current_round();

-- One-time normalization of any non-canonical existing values
UPDATE public.competition_entries
SET current_round = public.current_round_int(current_round)::text
WHERE current_round IS NOT NULL
  AND current_round !~ '^[1-4]$'
  AND public.current_round_int(current_round) BETWEEN 1 AND 4;

UPDATE public.competitions
SET current_round = public.current_round_int(current_round)::text
WHERE current_round IS NOT NULL
  AND current_round !~ '^[1-4]$'
  AND public.current_round_int(current_round) BETWEEN 1 AND 4;

-- 4) Rewrite get_round_eligible_photos — judge_decisions ONLY, no string fallbacks
CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(_competition_id uuid, _round_number integer)
RETURNS TABLE(entry_id uuid, photo_index integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH eligible_prior AS (
    -- Authoritative: read judge_decisions only. R1 trigger guarantees
    -- system tags are mirrored here, so no string-matching fallback.
    SELECT
      jd.entry_id,
      COALESCE(jd.photo_index, 0) AS photo_index
    FROM public.judge_decisions jd
    JOIN public.competition_judges cj
      ON cj.judge_id = jd.judge_id
     AND cj.competition_id = _competition_id
    WHERE jd.round_number = _round_number - 1
      AND public.is_qualifying_decision(jd.decision, _round_number - 1)
    GROUP BY jd.entry_id, COALESCE(jd.photo_index, 0)
  )
  SELECT ce.id AS entry_id, gs.idx AS photo_index
  FROM public.competition_entries ce
  CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
  WHERE ce.competition_id = _competition_id
    AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
    AND (
      _round_number = 1
      OR EXISTS (
        SELECT 1 FROM eligible_prior ep
        WHERE ep.entry_id = ce.id AND ep.photo_index = gs.idx
      )
    );
$function$;

-- 5) Rewrite get_per_photo_consensus — drop round1_tag_decs fallback
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
  -- AUTHORITATIVE: judge_decisions only. R1 trigger keeps tags mirrored.
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
      WHEN w.round_number = 2 AND w.win_decision = 'needs_review' THEN 'needs_review'
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
$function$;