CREATE OR REPLACE FUNCTION public.any_photo_pending(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ent AS (
    SELECT
      ce.id,
      ce.competition_id,
      NULLIF(regexp_replace(COALESCE(ce.current_round, ''), '[^0-9]', '', 'g'), '')::int AS r
    FROM public.competition_entries ce
    WHERE ce.id = p_entry_id
  ),
  expected AS (
    SELECT gp.entry_id, gp.photo_index, e.r
    FROM ent e
    JOIN LATERAL public.get_round_eligible_photos(e.competition_id, e.r) gp
      ON gp.entry_id = e.id
    WHERE e.r IS NOT NULL
  ),
  decided AS (
    SELECT DISTINCT x.entry_id, x.photo_index
    FROM expected x
    JOIN public.judge_decisions jd
      ON jd.entry_id = x.entry_id
     AND COALESCE(jd.photo_index, 0) = x.photo_index
     AND jd.round_number = x.r
    JOIN public.v3_stage_catalog c
      ON c.decision_token = jd.decision
     AND c.round_number = jd.round_number
     AND c.is_active = true
  )
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM expected x
      LEFT JOIN decided d
        ON d.entry_id = x.entry_id
       AND d.photo_index = x.photo_index
      WHERE d.entry_id IS NULL
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.any_photo_pending(uuid) IS
'Phase 3 pending gate. TRUE only when an eligible photo for the entry current_round lacks a valid judge_decisions row. Eligibility is delegated to get_round_eligible_photos so UI, round completion, rejected-photo exclusion, and verification holds stay aligned.';