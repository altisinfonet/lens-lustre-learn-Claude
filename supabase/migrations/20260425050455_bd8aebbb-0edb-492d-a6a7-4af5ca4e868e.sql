CREATE OR REPLACE FUNCTION public.judging_invariants_check()
RETURNS TABLE(check_name text, status text, fail_count integer, sample jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- Allow service-role (auth.uid() IS NULL) for cron/tests; otherwise require admin.
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  WITH drift AS (
    SELECT jta.entry_id, jta.judge_id, jta.tag_id, m.round_number, m.decision
    FROM public.judge_tag_assignments jta
    JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
    LEFT JOIN public.judge_decisions jd
      ON jd.entry_id = jta.entry_id
     AND jd.judge_id = jta.judge_id
     AND jd.round_number = m.round_number
     AND jd.decision = m.decision
     AND COALESCE(jd.photo_index, 0) = COALESCE(jta.photo_index, 0)
    WHERE jd.id IS NULL
  )
  SELECT 'tag_decision_drift'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(d)) FILTER (WHERE d.entry_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM drift LIMIT 5) d;

  RETURN QUERY
  WITH bad AS (
    SELECT 'competition_entries' AS t, id::text, current_round
    FROM public.competition_entries
    WHERE current_round IS NOT NULL AND current_round !~ '^[1-4]$'
    UNION ALL
    SELECT 'competitions', id::text, current_round
    FROM public.competitions
    WHERE current_round IS NOT NULL AND current_round !~ '^[1-4]$'
  )
  SELECT 'current_round_canonical'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(b)) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM bad LIMIT 5) b;

  RETURN QUERY
  WITH bad AS (
    SELECT id::text, decision, round_number
    FROM public.judge_decisions
    WHERE lower(decision) NOT IN (
      'accept','accepted','shortlist','shortlisted','qualified',
      'reject','rejected','needs_review','skip',
      'finalist','winner'
    )
  )
  SELECT 'decision_vocabulary'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(b)) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM bad LIMIT 5) b;

  RETURN QUERY
  WITH per_comp AS (
    SELECT c.id AS competition_id,
           public.current_round_int(c.current_round) AS rn
    FROM public.competitions c
    WHERE c.current_round IS NOT NULL
      AND public.current_round_int(c.current_round) >= 2
  ),
  expected AS (
    SELECT pc.competition_id, jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index
    FROM per_comp pc
    JOIN public.judge_decisions jd ON jd.round_number = pc.rn - 1
    JOIN public.competition_entries ce ON ce.id = jd.entry_id AND ce.competition_id = pc.competition_id
    JOIN public.competition_judges cj ON cj.judge_id = jd.judge_id AND cj.competition_id = pc.competition_id
    WHERE public.is_qualifying_decision(jd.decision, pc.rn - 1)
    GROUP BY pc.competition_id, jd.entry_id, COALESCE(jd.photo_index, 0)
  ),
  actual AS (
    SELECT pc.competition_id, ge.entry_id, ge.photo_index
    FROM per_comp pc, LATERAL public.get_round_eligible_photos(pc.competition_id, pc.rn) ge
  ),
  diff AS (
    SELECT 'missing' AS kind, competition_id, entry_id, photo_index FROM expected
    EXCEPT SELECT 'missing', competition_id, entry_id, photo_index FROM actual
    UNION ALL
    SELECT 'extra' AS kind, competition_id, entry_id, photo_index FROM actual
    EXCEPT SELECT 'extra', competition_id, entry_id, photo_index FROM expected
  )
  SELECT 'eligibility_consistency'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(d)) FILTER (WHERE d.entry_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM diff LIMIT 5) d;
END;
$$;