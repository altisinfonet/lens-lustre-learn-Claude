
-- Phase R4 Hardening — Tag↔Decision Drift Backfill RPC
-- Mirror-fixes the exact rows the audit reports as `tag_decision_drift`.
-- SECURITY DEFINER + admin guard. Idempotent (uses ON CONFLICT DO NOTHING).

CREATE OR REPLACE FUNCTION public.backfill_tag_decision_drift_admin()
RETURNS TABLE(inserted_count integer, scanned_count integer, sample jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inserted integer := 0;
  v_scanned  integer := 0;
  v_sample   jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- Drift = tag exists, decision missing. Mirrors judging_invariants_check #1.
  WITH drift AS (
    SELECT jta.entry_id, jta.judge_id, jta.tag_id,
           jta.photo_index, m.round_number, m.decision
    FROM public.judge_tag_assignments jta
    JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
    LEFT JOIN public.judge_decisions jd
      ON jd.entry_id = jta.entry_id
     AND jd.judge_id = jta.judge_id
     AND jd.round_number = m.round_number
     AND jd.decision = m.decision
     AND COALESCE(jd.photo_index, 0) = COALESCE(jta.photo_index, 0)
    WHERE jd.id IS NULL
  ),
  ins AS (
    INSERT INTO public.judge_decisions
      (entry_id, judge_id, round_number, photo_index, decision, updated_at)
    SELECT entry_id, judge_id, round_number,
           COALESCE(photo_index, 0), decision, now()
    FROM drift
    ON CONFLICT (entry_id, judge_id, round_number, photo_index)
    DO NOTHING
    RETURNING entry_id, judge_id, round_number, photo_index, decision
  )
  SELECT
    (SELECT count(*) FROM ins)::int,
    (SELECT count(*) FROM drift)::int,
    COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM (SELECT * FROM ins LIMIT 5) i),
             '[]'::jsonb)
  INTO v_inserted, v_scanned, v_sample;

  -- Audit log entry (best effort)
  INSERT INTO public.db_audit_logs
    (table_name, operation, row_id, new_data, performed_by)
  VALUES (
    'judging_invariants',
    'backfill_tag_decision_drift',
    'tag_decision_drift',
    jsonb_build_object(
      'inserted', v_inserted,
      'scanned',  v_scanned,
      'sample',   v_sample,
      'ran_at',   now()
    ),
    v_caller
  );

  RETURN QUERY SELECT v_inserted, v_scanned, v_sample;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_tag_decision_drift_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_tag_decision_drift_admin() TO authenticated;
