-- Fix 4 broken Admin Panel audit functions (evidence-based deep audit).
-- 1) get_entry_status_drift_admin + _summary: gate called non-existent is_admin_or_higher(uuid) -> has_role(auth.uid(),'admin'); summary also had ambiguous 'bucket'.
-- 2) list_tag_decision_drift_admin: profiles has no user_id/username -> p.id and p.custom_url.
-- 3) get_test_agent_health_admin: get_per_photo_consensus() has no status_legacy column -> dropped that predicate.

CREATE OR REPLACE FUNCTION public.get_entry_status_drift_admin()
 RETURNS TABLE(entry_id uuid, competition_id uuid, stored_status text, derived_status text, stored_placement text, derived_placement text, progression_decision text, current_round text, drift_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  WITH cmp AS (
    SELECT
      ce.id AS entry_id,
      ce.competition_id,
      ce.status AS stored_status,
      eps.public_status AS derived_status,
      ce.placement AS stored_placement,
      eps.public_placement AS derived_placement,
      ce.progression_decision,
      ce.current_round
    FROM public.competition_entries ce
    LEFT JOIN public.entry_public_status eps ON eps.entry_id = ce.id
  )
  SELECT
    c.entry_id,
    c.competition_id,
    c.stored_status,
    c.derived_status,
    c.stored_placement,
    c.derived_placement,
    c.progression_decision,
    c.current_round,
    CASE
      WHEN c.stored_status IS DISTINCT FROM c.derived_status
        AND c.stored_placement IS DISTINCT FROM c.derived_placement THEN 'status_and_placement_drift'
      WHEN c.stored_status IS DISTINCT FROM c.derived_status THEN 'status_drift'
      WHEN c.stored_placement IS DISTINCT FROM c.derived_placement THEN 'placement_drift'
      ELSE 'unknown'
    END AS drift_kind
  FROM cmp c
  WHERE
    -- exclude the legitimate pre-publish privacy gate
    NOT (c.derived_status = 'judging_in_progress'
         AND c.stored_status IN ('submitted','rejected','needs_review'))
    AND (
      c.stored_status IS DISTINCT FROM c.derived_status
      OR c.stored_placement IS DISTINCT FROM c.derived_placement
    );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.get_entry_status_drift_summary_admin()
 RETURNS TABLE(bucket text, count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  RETURN QUERY
  WITH cmp AS (
    SELECT
      ce.id AS entry_id,
      ce.status AS stored_status,
      eps.public_status AS derived_status,
      ce.placement AS stored_placement,
      eps.public_placement AS derived_placement
    FROM public.competition_entries ce
    LEFT JOIN public.entry_public_status eps ON eps.entry_id = ce.id
  ),
  classified AS (
    SELECT
      CASE
        WHEN stored_status = derived_status
             AND stored_placement IS NOT DISTINCT FROM derived_placement THEN 'match'
        WHEN derived_status = 'judging_in_progress'
             AND stored_status IN ('submitted','rejected','needs_review') THEN 'expected_pre_publish'
        ELSE 'DRIFT'
      END AS bucket
    FROM cmp
  )
  SELECT classified.bucket, count(*)::bigint
  FROM classified
  GROUP BY classified.bucket
  ORDER BY classified.bucket;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.list_tag_decision_drift_admin()
 RETURNS TABLE(entry_id uuid, competition_id uuid, competition_title text, judge_id uuid, judge_handle text, tag_id uuid, tag_label text, round_number integer, decision text, photo_index integer, entry_title text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    COALESCE(p.full_name, p.custom_url, 'Judge ' || substr(jta.judge_id::text,1,8)) AS judge_handle,
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
  LEFT JOIN public.profiles p ON p.id = jta.judge_id
  WHERE jd.id IS NULL
  ORDER BY c.title NULLS LAST, m.round_number, ce.title NULLS LAST, jta.photo_index;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.get_test_agent_health_admin()
 RETURNS TABLE(rpc_parity_pass boolean, rpc_parity_sample_size integer, rpc_parity_mismatch_count integer, nr_drift_5min integer, nr_drift_24h integer, dual_emit_status text, super_admin_email text, checked_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sample UUID[];
  v_mismatch_count INTEGER := 0;
  v_sample_size INTEGER := 0;
  v_admin_email TEXT;
  v_dual_emit TEXT := 'unknown';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  SELECT array_agg(id) INTO v_sample
  FROM (
    SELECT id FROM public.competition_entries
    WHERE status IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 50
  ) s;

  IF v_sample IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sample_size
    FROM public.get_per_photo_consensus(v_sample);

    SELECT COUNT(*) INTO v_mismatch_count
    FROM public.get_per_photo_consensus(v_sample)
    WHERE status IS NULL;

    v_dual_emit := CASE
      WHEN v_sample_size = 0 THEN 'no_data'
      WHEN v_mismatch_count = 0 THEN 'healthy'
      ELSE 'drift_detected'
    END;
  END IF;

  SELECT u.email::text INTO v_admin_email
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.role::text = 'admin'
    AND u.email IS NOT NULL
  ORDER BY u.email
  LIMIT 1;

  RETURN QUERY SELECT
    (v_mismatch_count = 0 AND v_sample_size > 0) AS rpc_parity_pass,
    v_sample_size,
    v_mismatch_count,
    (SELECT COUNT(*)::INTEGER FROM public.db_audit_logs
     WHERE operation = 'NR_DRIFT_R2_PLUS'
       AND created_at > now() - interval '5 minutes'),
    (SELECT COUNT(*)::INTEGER FROM public.db_audit_logs
     WHERE operation = 'NR_DRIFT_R2_PLUS'
       AND created_at > now() - interval '24 hours'),
    v_dual_emit,
    v_admin_email,
    now();
END;
$function$

;
