-- J-03 Parity Check (tag-only, single judge)
-- Forensic RPC that compares, for one (judge, competition, round):
--   • sidebar_unjudged  = eligible_photos − photos_with_a_tag_by_this_judge
--   • grid_unjudged     = eligible_photos NOT IN (photos this judge tagged)
-- Eligible-photo set:
--   • Round 1 → every photo of every submitted entry in the competition
--   • Round 2+ → photos any judge shortlisted/qualified in the prior round
--                (any-judge-shortlist rule, mirrors round-close coverage gate)
-- Returns one row with the two counters + a drift delta + the offending
-- (entry_id, photo_index) list when they disagree. Read-only.

CREATE OR REPLACE FUNCTION public.get_unjudged_parity_admin(
  p_judge_id uuid,
  p_competition_id uuid,
  p_round_number int
)
RETURNS TABLE (
  judge_id uuid,
  competition_id uuid,
  round_number int,
  eligible_count int,
  tagged_count int,
  sidebar_unjudged int,
  grid_unjudged int,
  drift int,
  drift_photos jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Admin gate (mirrors other forensic RPCs)
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    INTO v_is_admin;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    -- Round 1: every photo of every submitted entry
    SELECT ce.id AS entry_id, gs.idx AS photo_index
    FROM public.competition_entries ce
    CROSS JOIN LATERAL generate_series(0, GREATEST(array_length(ce.photos, 1), 1) - 1) AS gs(idx)
    WHERE ce.competition_id = p_competition_id
      AND ce.status = 'submitted'
      AND p_round_number = 1

    UNION ALL

    -- Round 2+: photos that ANY judge tagged as shortlist/qualified in prior round
    SELECT jpt.entry_id, jpt.photo_index
    FROM public.judge_photo_tags jpt
    JOIN public.judging_tags t ON t.id = jpt.tag_id
    JOIN public.competition_entries ce ON ce.id = jpt.entry_id
    WHERE ce.competition_id = p_competition_id
      AND p_round_number > 1
      AND jpt.round_number = p_round_number - 1
      AND COALESCE(t.label, '') ILIKE ANY (ARRAY['%shortlist%', '%qualified%'])
    GROUP BY jpt.entry_id, jpt.photo_index
  ),
  eligible_dedup AS (
    SELECT DISTINCT entry_id, photo_index FROM eligible
  ),
  tagged AS (
    SELECT DISTINCT jpt.entry_id, jpt.photo_index
    FROM public.judge_photo_tags jpt
    JOIN public.competition_entries ce ON ce.id = jpt.entry_id
    WHERE ce.competition_id = p_competition_id
      AND jpt.judge_id = p_judge_id
      AND jpt.round_number = p_round_number
  ),
  unjudged AS (
    SELECT e.entry_id, e.photo_index
    FROM eligible_dedup e
    LEFT JOIN tagged tg
      ON tg.entry_id = e.entry_id AND tg.photo_index = e.photo_index
    WHERE tg.entry_id IS NULL
  ),
  totals AS (
    SELECT
      (SELECT count(*)::int FROM eligible_dedup)               AS eligible_count,
      (SELECT count(*)::int FROM tagged
        WHERE (entry_id, photo_index) IN
              (SELECT entry_id, photo_index FROM eligible_dedup)) AS tagged_count,
      (SELECT count(*)::int FROM unjudged)                     AS unjudged_count
  )
  SELECT
    p_judge_id,
    p_competition_id,
    p_round_number,
    t.eligible_count,
    t.tagged_count,
    (t.eligible_count - t.tagged_count)::int  AS sidebar_unjudged,
    t.unjudged_count                          AS grid_unjudged,
    ((t.eligible_count - t.tagged_count) - t.unjudged_count)::int AS drift,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'entry_id', u.entry_id,
        'photo_index', u.photo_index
      ) ORDER BY u.entry_id, u.photo_index)
       FROM unjudged u),
      '[]'::jsonb
    ) AS drift_photos
  FROM totals t;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unjudged_parity_admin(uuid, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unjudged_parity_admin(uuid, uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_unjudged_parity_admin(uuid, uuid, int) IS
  'J-03 forensic parity: compares sidebar unjudged count vs grid unjudged set for one (judge, competition, round) under the strict v5 tag-only rule. Admin/super_admin only.';
