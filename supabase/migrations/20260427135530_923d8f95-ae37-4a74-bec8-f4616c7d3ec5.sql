CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(
  _competition_id uuid,
  _round_number  int
)
RETURNS TABLE(entry_id uuid, photo_index int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.photo_verification_requests') IS NOT NULL THEN
    RETURN QUERY EXECUTE $sql$
      WITH eligible_prior AS (
        SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index
        FROM public.judge_decisions jd
        JOIN public.competition_judges cj
          ON cj.judge_id = jd.judge_id
         AND cj.competition_id = $1
        WHERE jd.round_number = $2 - 1
          AND public.is_qualifying_decision(jd.decision, $2 - 1)
        GROUP BY jd.entry_id, COALESCE(jd.photo_index, 0)
      ),
      active_verification AS (
        SELECT pvr.entry_id, COALESCE(pvr.photo_index, 0) AS photo_index
        FROM public.photo_verification_requests pvr
        WHERE pvr.competition_id = $1
          AND pvr.status IN ('pending', 'submitted')
      )
      SELECT ce.id, gs.idx
      FROM public.competition_entries ce
      CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
      WHERE ce.competition_id = $1
        AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
        AND NOT EXISTS (SELECT 1 FROM active_verification av WHERE av.entry_id = ce.id AND av.photo_index = gs.idx)
        AND (
          $2 = 1
          OR EXISTS (SELECT 1 FROM eligible_prior ep WHERE ep.entry_id = ce.id AND ep.photo_index = gs.idx)
        )
    $sql$ USING _competition_id, _round_number;
  ELSE
    RETURN QUERY
      WITH eligible_prior AS (
        SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index
        FROM public.judge_decisions jd
        JOIN public.competition_judges cj
          ON cj.judge_id = jd.judge_id
         AND cj.competition_id = _competition_id
        WHERE jd.round_number = _round_number - 1
          AND public.is_qualifying_decision(jd.decision, _round_number - 1)
        GROUP BY jd.entry_id, COALESCE(jd.photo_index, 0)
      )
      SELECT ce.id, gs.idx
      FROM public.competition_entries ce
      CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
      WHERE ce.competition_id = _competition_id
        AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
        AND (
          _round_number = 1
          OR EXISTS (SELECT 1 FROM eligible_prior ep WHERE ep.entry_id = ce.id AND ep.photo_index = gs.idx)
        );
  END IF;
END;
$$;