-- Fix the stale Round 3 system-tag mapping that made the repair button appear to do nothing.
-- The current catalog decision for the old UI label "Shortlist for Final Round" is qualified_final.
UPDATE public.system_tag_decision_map m
SET decision = 'qualified_final'
FROM public.judging_tags jt
WHERE jt.id = m.tag_id
  AND m.round_number = 3
  AND lower(trim(jt.label)) = 'shortlist for final round'
  AND m.decision <> 'qualified_final';

-- Make the admin backfill repair existing conflicts as well as missing rows.
-- Keep the existing return shape so the frontend continues to work.
CREATE OR REPLACE FUNCTION public.backfill_tag_decision_drift_admin()
RETURNS TABLE(inserted_count integer, scanned_count integer, sample jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_fixed integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_scanned integer := 0;
  v_sample jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  PERFORM set_config('app.bypass_round_lock', 'on', true);
  PERFORM set_config('app.bypass_mirror_trigger', 'on', true);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp._tag_decision_backfill_plan (
    entry_id uuid,
    judge_id uuid,
    round_number integer,
    photo_index integer,
    decision text,
    tag_id uuid,
    existing_id uuid,
    existing_decision text
  ) ON COMMIT DROP;

  TRUNCATE pg_temp._tag_decision_backfill_plan;

  INSERT INTO pg_temp._tag_decision_backfill_plan
    (entry_id, judge_id, round_number, photo_index, decision, tag_id, existing_id, existing_decision)
  SELECT DISTINCT ON (jta.entry_id, jta.judge_id, m.round_number, COALESCE(jta.photo_index, 0))
         jta.entry_id,
         jta.judge_id,
         m.round_number,
         COALESCE(jta.photo_index, 0),
         m.decision,
         jta.tag_id,
         jd.id,
         jd.decision
  FROM public.judge_tag_assignments jta
  JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
  LEFT JOIN public.judge_decisions jd
    ON jd.entry_id = jta.entry_id
   AND jd.judge_id = jta.judge_id
   AND jd.round_number = m.round_number
   AND COALESCE(jd.photo_index, 0) = COALESCE(jta.photo_index, 0)
  WHERE jd.id IS NULL OR jd.decision IS DISTINCT FROM m.decision
  ORDER BY jta.entry_id, jta.judge_id, m.round_number, COALESCE(jta.photo_index, 0), jta.created_at DESC;

  SELECT count(*)::int INTO v_scanned FROM pg_temp._tag_decision_backfill_plan;

  WITH upd AS (
    UPDATE public.judge_decisions jd
       SET decision = p.decision,
           updated_at = now()
      FROM pg_temp._tag_decision_backfill_plan p
     WHERE jd.id = p.existing_id
       AND jd.decision IS DISTINCT FROM p.decision
    RETURNING jd.id
  )
  SELECT count(*)::int INTO v_updated FROM upd;

  WITH ins AS (
    INSERT INTO public.judge_decisions
      (entry_id, judge_id, round_number, photo_index, decision, updated_at)
    SELECT p.entry_id, p.judge_id, p.round_number, p.photo_index, p.decision, now()
    FROM pg_temp._tag_decision_backfill_plan p
    WHERE p.existing_id IS NULL
    ON CONFLICT (entry_id, judge_id, round_number, photo_index)
    DO UPDATE SET decision = EXCLUDED.decision,
                  updated_at = now()
    RETURNING id
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  v_fixed := v_inserted + v_updated;

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  INTO v_sample
  FROM (
    SELECT entry_id, judge_id, round_number, photo_index, decision, existing_decision, tag_id
    FROM pg_temp._tag_decision_backfill_plan
    LIMIT 5
  ) s;

  INSERT INTO public.db_audit_logs
    (table_name, operation, row_id, new_data, changed_by)
  VALUES (
    'judging_invariants',
    'backfill_tag_decision_drift',
    'tag_decision_drift',
    jsonb_build_object(
      'fixed', v_fixed,
      'inserted', v_inserted,
      'updated', v_updated,
      'scanned', v_scanned,
      'sample', v_sample,
      'ran_at', now()
    ),
    v_caller
  );

  -- inserted_count now means "fixed rows" for backward-compatible UI text.
  RETURN QUERY SELECT v_fixed, v_scanned, v_sample;
END;
$function$;

REVOKE ALL ON FUNCTION public.backfill_tag_decision_drift_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_tag_decision_drift_admin() TO authenticated;