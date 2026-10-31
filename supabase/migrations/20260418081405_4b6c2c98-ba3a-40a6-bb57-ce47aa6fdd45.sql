-- C-4 part 1: Public per-judge per-criterion score RPC
-- SOW (page 1, line 22): "any marks given by Judge will be visible to public. Only after final declaration on each round not instantly"
-- Stakeholder clarification: per-judge per-criterion (all 10 sliders) once round declared. Judge name hidden as "Judge 1", "Judge 2"...

CREATE OR REPLACE FUNCTION public.get_public_round_scores(
  p_competition_id uuid,
  p_round_number integer
)
RETURNS TABLE (
  entry_id uuid,
  photo_index integer,
  anonymized_judge_label text,
  line_score integer,
  shape_score integer,
  form_score integer,
  texture_score integer,
  color_palette_score numeric,
  space_score integer,
  tone_score integer,
  balance_score integer,
  light_score integer,
  depth_score integer,
  average_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gate: round must be officially completed before any scores are revealed
  IF NOT EXISTS (
    SELECT 1 FROM public.judging_rounds jr
    WHERE jr.competition_id = p_competition_id
      AND jr.round_number = p_round_number
      AND jr.status = 'completed'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH judge_labels AS (
    SELECT
      js.judge_id,
      'Judge ' || dense_rank() OVER (ORDER BY js.judge_id)::text AS label
    FROM public.judge_scores js
    JOIN public.competition_entries ce ON ce.id = js.entry_id
    WHERE ce.competition_id = p_competition_id
    GROUP BY js.judge_id
  )
  SELECT
    js.entry_id,
    js.photo_index,
    jl.label AS anonymized_judge_label,
    js.line_score,
    js.shape_score,
    js.form_score,
    js.texture_score,
    js.color_palette_score,
    js.space_score,
    js.tone_score,
    js.balance_score,
    js.light_score,
    js.depth_score,
    ROUND((
      COALESCE(js.line_score,0) + COALESCE(js.shape_score,0) + COALESCE(js.form_score,0) +
      COALESCE(js.texture_score,0) + COALESCE(js.color_palette_score,0) + COALESCE(js.space_score,0) +
      COALESCE(js.tone_score,0) + COALESCE(js.balance_score,0) + COALESCE(js.light_score,0) +
      COALESCE(js.depth_score,0)
    )::numeric / NULLIF((
      (CASE WHEN js.line_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.shape_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.form_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.texture_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.color_palette_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.space_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.tone_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.balance_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.light_score IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN js.depth_score IS NOT NULL THEN 1 ELSE 0 END)
    ), 0), 2) AS average_score
  FROM public.judge_scores js
  JOIN public.competition_entries ce ON ce.id = js.entry_id
  JOIN judge_labels jl ON jl.judge_id = js.judge_id
  WHERE ce.competition_id = p_competition_id
  ORDER BY js.entry_id, js.photo_index, jl.label;
END;
$$;

-- Allow public + authenticated to call. No judge identity leaks (function returns labels only).
GRANT EXECUTE ON FUNCTION public.get_public_round_scores(uuid, integer) TO anon, authenticated;