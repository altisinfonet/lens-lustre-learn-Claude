CREATE OR REPLACE FUNCTION public.any_photo_pending(p_entry_id uuid, p_round_number integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ent AS (
    SELECT ce.id, ce.competition_id, p_round_number AS r
    FROM public.competition_entries ce
    WHERE ce.id = p_entry_id
      AND p_round_number BETWEEN 1 AND 4
  ),
  expected AS (
    SELECT gp.entry_id, gp.photo_index, e.r
    FROM ent e
    JOIN LATERAL public.get_round_eligible_photos(e.competition_id, e.r) gp
      ON gp.entry_id = e.id
  ),
  decision_decided AS (
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
  ),
  tag_decided AS (
    SELECT DISTINCT x.entry_id, x.photo_index
    FROM expected x
    JOIN public.judge_tag_assignments jta
      ON jta.entry_id = x.entry_id
     AND COALESCE(jta.photo_index, 0) = x.photo_index
     AND jta.round_number = x.r
    JOIN public.judging_tags jt
      ON jt.id = jta.tag_id
    JOIN public.v3_stage_catalog c
      ON c.round_number = jta.round_number
     AND c.is_active = true
     AND (
       lower(trim(c.tag_label_canonical)) = lower(trim(jt.label))
       OR (jta.round_number = 4 AND lower(trim(jt.label)) IN (
         'qualified for final round',
         'qualified for final',
         'top 50',
         'top 50 global photographer',
         'top 100',
         'top 100 global photographer',
         'winner',
         '1st runner-up',
         '1st runner up',
         '2nd runner-up',
         '2nd runner up',
         'honorary mention',
         'special jury award',
         'special jury'
       ))
     )
  ),
  decided AS (
    SELECT * FROM decision_decided
    UNION
    SELECT * FROM tag_decided
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
$function$;