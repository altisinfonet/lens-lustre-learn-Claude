CREATE OR REPLACE FUNCTION public.get_per_photo_placement(p_entry_ids uuid[])
 RETURNS TABLE(entry_id uuid, photo_index integer, round_number integer, status text, award_label text, declared boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_caller IS NOT NULL THEN
    v_is_admin := public.has_role(v_caller, 'admin'::app_role);
  END IF;

  RETURN QUERY
  WITH visible_entries AS (
    SELECT ce.id, ce.competition_id, ce.user_id,
      CASE
        WHEN v_is_admin THEN 'admin'
        WHEN v_caller IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.competition_judges cj
          WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller
        ) THEN 'judge'
        WHEN v_caller IS NOT NULL AND ce.user_id = v_caller THEN 'owner'
        ELSE 'public'
      END AS viewer_role
    FROM public.competition_entries ce
    WHERE ce.id = ANY(p_entry_ids)
  ),
  declared_r4 AS (
    SELECT crp.competition_id, crp.published_at IS NOT NULL AS is_declared
    FROM public.competition_round_publish crp
    WHERE crp.round_number = 4
  ),
  raw_tags AS (
    SELECT
      jta.entry_id,
      COALESCE(jta.photo_index, 0) AS photo_index,
      jt.label AS award_label,
      CASE LOWER(TRIM(jt.label))
        WHEN 'winner' THEN 'r4_winner'
        WHEN '1st runner-up' THEN 'r4_runner_up_1'
        WHEN '2nd runner-up' THEN 'r4_runner_up_2'
        WHEN 'top 50' THEN 'r4_top_50'
        WHEN 'top 50 global photographer' THEN 'r4_top_50'
        WHEN 'top 100' THEN 'r4_top_100'
        WHEN 'top 100 global photographer' THEN 'r4_top_100'
        WHEN 'finalist' THEN 'r4_finalist'
        WHEN 'qualified for final' THEN 'r4_finalist'
        WHEN 'qualified for final round' THEN 'r4_finalist'
        WHEN 'honorary mention' THEN 'r4_honorary_mention'
        WHEN 'honourable mention' THEN 'r4_honorary_mention'
        WHEN 'honorable mention' THEN 'r4_honorary_mention'
        WHEN 'special jury award' THEN 'r4_special_jury'
        WHEN 'special jury' THEN 'r4_special_jury'
        ELSE NULL
      END AS canon_key
    FROM public.judge_tag_assignments jta
    JOIN public.judging_tags jt ON jt.id = jta.tag_id
    JOIN visible_entries ve ON ve.id = jta.entry_id
    WHERE jta.round_number = 4
      AND (
        ve.viewer_role IN ('admin','judge')
        OR COALESCE((SELECT dr.is_declared FROM declared_r4 dr WHERE dr.competition_id = ve.competition_id LIMIT 1), false)
      )
  ),
  prio(canon_key, prio) AS (
    VALUES
      ('r4_winner', 100),
      ('r4_runner_up_1', 90),
      ('r4_runner_up_2', 80),
      ('r4_top_50', 70),
      ('r4_top_100', 60),
      ('r4_finalist', 50),
      ('r4_honorary_mention', 40),
      ('r4_special_jury', 30)
  ),
  ranked AS (
    SELECT rt.entry_id, rt.photo_index, rt.canon_key, rt.award_label,
           ROW_NUMBER() OVER (
             PARTITION BY rt.entry_id, rt.photo_index
             ORDER BY COALESCE(p.prio, 0) DESC, rt.award_label ASC
           ) AS rn
    FROM raw_tags rt
    LEFT JOIN prio p ON p.canon_key = rt.canon_key
    WHERE rt.canon_key IS NOT NULL
  )
  SELECT
    r.entry_id, r.photo_index, 4 AS round_number,
    r.canon_key AS status, r.award_label,
    COALESCE((SELECT dr.is_declared FROM declared_r4 dr
              JOIN visible_entries ve ON ve.competition_id = dr.competition_id
              WHERE ve.id = r.entry_id LIMIT 1), false) AS declared
  FROM ranked r
  WHERE r.rn = 1
  ORDER BY r.entry_id, r.photo_index;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_per_photo_placement(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_per_photo_placement(uuid[]) TO authenticated, anon;

COMMENT ON FUNCTION public.get_per_photo_placement(uuid[]) IS
'Per-photo R4 placement source. Privacy: admin/judge may inspect before declaration; owners/public receive rows only after Round 4 is declared.';