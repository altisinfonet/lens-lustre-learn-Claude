
CREATE OR REPLACE FUNCTION public.any_photo_pending(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ent AS (
    SELECT
      id,
      NULLIF(regexp_replace(COALESCE(current_round, ''), '[^0-9]', '', 'g'), '')::int AS r,
      COALESCE(jsonb_array_length(photo_meta), 0) AS pcount
    FROM public.competition_entries
    WHERE id = p_entry_id
  ),
  expected AS (
    SELECT e.id AS entry_id, e.r, gs AS photo_index
    FROM ent e, generate_series(0, e.pcount - 1) gs
    WHERE e.pcount > 0 AND e.r IS NOT NULL
  ),
  decided AS (
    SELECT DISTINCT x.entry_id, x.photo_index
    FROM expected x
    JOIN public.judge_decisions jd
      ON jd.entry_id    = x.entry_id
     AND jd.photo_index = x.photo_index
     AND jd.round_number = x.r
    JOIN public.v3_stage_catalog c
      ON c.decision_token = jd.decision
     AND c.round_number   = jd.round_number
     AND c.is_active      = true
  )
  SELECT COALESCE(
    (SELECT EXISTS (
       SELECT 1
       FROM expected x
       LEFT JOIN decided d
         ON d.entry_id = x.entry_id AND d.photo_index = x.photo_index
       WHERE d.entry_id IS NULL
     )),
    false
  );
$$;

COMMENT ON FUNCTION public.any_photo_pending(uuid) IS
'Phase 3 · Step 1. TRUE if any photo (entry_id, photo_index 0..jsonb_array_length(photo_meta)-1) has zero valid judge_decisions rows for the entry''s current_round, where validity = decision matches an active v3_stage_catalog.decision_token for that round. needs_review counts as decided. Coverage = ≥1 judge.';
