-- JP-H-5: Restrict get_round_eligible_photos to admins, assigned judges, or service_role callers.
-- Preserves body byte-for-byte from migration 20260427135530; only prepends auth guard.
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
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Authorization guard. service_role / internal LATERAL callers have auth.jwt() IS NULL
  -- and are permitted to bypass (wrapper RPCs enforce their own auth model).
  IF auth.jwt() IS NOT NULL AND _uid IS NOT NULL THEN
    IF NOT (
      public.has_role(_uid, 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.competition_judges cj
        WHERE cj.judge_id = _uid AND cj.competition_id = _competition_id
      )
    ) THEN
      RAISE EXCEPTION 'forbidden: not assigned to competition %', _competition_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.get_round_eligible_photos(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_eligible_photos(uuid, integer) TO service_role;