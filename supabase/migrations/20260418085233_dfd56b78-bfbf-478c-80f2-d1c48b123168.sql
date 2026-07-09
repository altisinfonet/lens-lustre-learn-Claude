-- P-1: get_round_summary — single round-trip aggregate for CompleteRoundDialog
-- Returns counts (total/qualified/rejected/needs_review/pending) + top-10 entries by avg_score
-- for a given competition + round, gated by judge/admin role.

CREATE OR REPLACE FUNCTION public.get_round_summary(
  p_competition_id uuid,
  p_round_number int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Counts in a single scan
  SELECT
    COUNT(*) FILTER (WHERE current_round = v_round_str),
    COUNT(*) FILTER (WHERE current_round = v_round_str AND status = ANY (ARRAY[
      'approved','shortlisted','round1_qualified','round2_qualified','finalist','winner',
      'runner_up_1','runner_up_2','special_jury','honourable_mention'
    ])),
    COUNT(*) FILTER (WHERE current_round = v_round_str AND status = 'rejected'),
    COUNT(*) FILTER (WHERE current_round = v_round_str AND status = 'needs_review')
  INTO v_total, v_qualified, v_rejected, v_needs_review
  FROM competition_entries
  WHERE competition_id = p_competition_id;

  v_pending := GREATEST(0, v_total - v_qualified - v_rejected - v_needs_review);

  -- Top 10 entries by avg_score for this round
  SELECT COALESCE(jsonb_agg(t ORDER BY t.avg_score DESC NULLS LAST), '[]'::jsonb)
  INTO v_top
  FROM (
    SELECT
      ce.id,
      ce.title,
      ce.status,
      (CASE WHEN array_length(ce.photos, 1) > 0 THEN ce.photos[1] ELSE NULL END) AS thumbnail,
      esc.avg_score
    FROM competition_entries ce
    LEFT JOIN entry_score_cache esc ON esc.entry_id = ce.id
    WHERE ce.competition_id = p_competition_id
      AND ce.current_round = v_round_str
    ORDER BY esc.avg_score DESC NULLS LAST
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
$$;

REVOKE ALL ON FUNCTION public.get_round_summary(uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_round_summary(uuid, int) TO authenticated;