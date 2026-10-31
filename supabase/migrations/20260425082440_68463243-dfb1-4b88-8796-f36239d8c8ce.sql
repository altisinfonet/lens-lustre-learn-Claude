-- R4 Hardening: exclude photos with active verification from get_round_eligible_photos
-- Rule 3 — verification overrides everything. A photo with pending/submitted
-- verification must NOT appear in R(n+1) eligible set until admin decides.
CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(_competition_id uuid, _round_number integer)
RETURNS TABLE(entry_id uuid, photo_index integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH eligible_prior AS (
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
  ),
  active_verification AS (
    -- Rule 3: any pending or submitted verification request blocks the photo
    -- from advancing to the next round until admin approves/rejects.
    SELECT pvr.entry_id, COALESCE(pvr.photo_index, 0) AS photo_index
    FROM public.photo_verification_requests pvr
    WHERE pvr.competition_id = _competition_id
      AND pvr.status IN ('pending', 'submitted')
  )
  SELECT ce.id AS entry_id, gs.idx AS photo_index
  FROM public.competition_entries ce
  CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
  WHERE ce.competition_id = _competition_id
    AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM active_verification av
      WHERE av.entry_id = ce.id AND av.photo_index = gs.idx
    )
    AND (
      _round_number = 1
      OR EXISTS (
        SELECT 1 FROM eligible_prior ep
        WHERE ep.entry_id = ce.id AND ep.photo_index = gs.idx
      )
    );
$function$;

GRANT EXECUTE ON FUNCTION public.get_round_eligible_photos(uuid, integer) TO authenticated;
