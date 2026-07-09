
-- Rebuild get_round_summary to count strictly PER-PHOTO from judge_decisions.
-- Previous version counted entry-level competition_entries.status, which violates
-- the per-photo rule: an entry with 5 photos = 5 independent decisions, not 1.
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT has_role(v_uid, 'admin'::app_role) INTO v_is_admin;
  SELECT has_role(v_uid, 'judge'::app_role) INTO v_is_judge;

  IF NOT (v_is_admin OR v_is_judge) THEN
    RAISE EXCEPTION 'Forbidden: judge or admin role required' USING ERRCODE = '42501';
  END IF;

  -- PER-PHOTO totals: each photo of each entry counts as 1 unit.
  -- Total = sum of photo counts across entries in this round.
  SELECT COALESCE(SUM(GREATEST(COALESCE(array_length(ce.photos, 1), 0), 1)), 0)
    INTO v_total
  FROM competition_entries ce
  WHERE ce.competition_id = p_competition_id
    AND ce.current_round = v_round_str;

  -- PER-PHOTO decisions: count distinct (entry_id, photo_index) pairs grouped by majority decision.
  -- For simplicity (and matching how the rest of the app aggregates), use the LATEST decision
  -- per (entry_id, photo_index) across all judges. Ties resolved by judge_id ordering.
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
    COUNT(*) FILTER (WHERE decision IN ('accept','accepted','shortlist','shortlisted','round1_qualified','round2_qualified','finalist','winner')),
    COUNT(*) FILTER (WHERE decision IN ('reject','rejected')),
    COUNT(*) FILTER (WHERE decision = 'needs_review')
  INTO v_qualified, v_rejected, v_needs_review
  FROM photo_decisions;

  v_pending := GREATEST(0, v_total - v_qualified - v_rejected - v_needs_review);

  -- Top 10 PHOTOS by avg_score (NOT entries). Show photo-level status from latest decision.
  WITH photo_scores AS (
    SELECT
      js.entry_id,
      js.photo_index,
      AVG(js.score)::numeric AS avg_score
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
    SELECT
      ce.id,
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
