-- Drill-down RPC: list every tag-decision drift row with full context for UI linking
CREATE OR REPLACE FUNCTION public.list_tag_decision_drift_admin()
RETURNS TABLE(
  entry_id uuid,
  competition_id uuid,
  competition_title text,
  judge_id uuid,
  judge_handle text,
  tag_id uuid,
  tag_label text,
  round_number int,
  decision text,
  photo_index int,
  entry_title text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    jta.entry_id,
    ce.competition_id,
    c.title AS competition_title,
    jta.judge_id,
    COALESCE(p.full_name, p.username, 'Judge ' || substr(jta.judge_id::text,1,8)) AS judge_handle,
    jta.tag_id,
    jt.label AS tag_label,
    m.round_number,
    m.decision,
    COALESCE(jta.photo_index, 0) AS photo_index,
    ce.title AS entry_title
  FROM public.judge_tag_assignments jta
  JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
  LEFT JOIN public.judge_decisions jd
    ON jd.entry_id = jta.entry_id
   AND jd.judge_id = jta.judge_id
   AND jd.round_number = m.round_number
   AND jd.decision = m.decision
   AND COALESCE(jd.photo_index, 0) = COALESCE(jta.photo_index, 0)
  LEFT JOIN public.competition_entries ce ON ce.id = jta.entry_id
  LEFT JOIN public.competitions c ON c.id = ce.competition_id
  LEFT JOIN public.judging_tags jt ON jt.id = jta.tag_id
  LEFT JOIN public.profiles p ON p.user_id = jta.judge_id
  WHERE jd.id IS NULL
  ORDER BY c.title NULLS LAST, m.round_number, ce.title NULLS LAST, jta.photo_index;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_tag_decision_drift_admin() TO authenticated;