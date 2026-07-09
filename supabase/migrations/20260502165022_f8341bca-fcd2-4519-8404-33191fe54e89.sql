CREATE OR REPLACE FUNCTION public.get_judging_live_tag_progression_invariant_admin()
RETURNS TABLE(
  check_name text,
  status text,
  proof text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH facts AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.judge_tag_assignments'::regclass
          AND tgname = 'trg_aggregate_tag_assignments'
          AND NOT tgisinternal
      ) AS obsolete_trigger_exists,
      (
        SELECT count(*)::int
        FROM pg_trigger
        WHERE tgrelid = 'public.judge_tag_assignments'::regclass
          AND NOT tgisinternal
          AND pg_get_triggerdef(oid) ILIKE '%mirror_system_tag_to_decision%'
      ) AS mirror_trigger_count,
      (
        SELECT pg_get_functiondef(p.oid)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'recompute_entry_from_tag_assignments'
        LIMIT 1
      ) AS recompute_def,
      (
        SELECT count(*)::int
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND pg_get_functiondef(p.oid) ILIKE '%UPDATE competition_entries%'
          AND pg_get_functiondef(p.oid) ILIKE '%progression_decision%'
          AND p.proname NOT IN (
            'enforce_progression_decision_pending_gate',
            'enforce_progression_decision_vocabulary',
            'get_judging_live_tag_progression_invariant_admin'
          )
      ) AS db_functions_with_live_progression_update
  )
  SELECT
    'obsolete_live_tag_aggregator_absent'::text,
    CASE WHEN obsolete_trigger_exists THEN 'FAIL' ELSE 'PASS' END,
    CASE WHEN obsolete_trigger_exists
      THEN 'trg_aggregate_tag_assignments still exists on judge_tag_assignments'
      ELSE 'trg_aggregate_tag_assignments is absent from judge_tag_assignments'
    END
  FROM facts
  UNION ALL
  SELECT
    'tag_to_decision_mirror_present'::text,
    CASE WHEN mirror_trigger_count >= 1 THEN 'PASS' ELSE 'FAIL' END,
    'mirror_system_tag_to_decision trigger count on judge_tag_assignments = ' || mirror_trigger_count::text
  FROM facts
  UNION ALL
  SELECT
    'deprecated_recompute_function_inert'::text,
    CASE
      WHEN recompute_def ILIKE '%BEGIN%RETURN;%END%' OR recompute_def ILIKE '%BEGIN% RETURN; %END%'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN recompute_def IS NULL THEN 'recompute_entry_from_tag_assignments function not found'
      WHEN recompute_def ILIKE '%UPDATE competition_entries%' THEN 'function still contains UPDATE competition_entries'
      ELSE 'recompute_entry_from_tag_assignments exists but returns without updating competition_entries'
    END
  FROM facts
  UNION ALL
  SELECT
    'no_other_live_progression_writer_function'::text,
    CASE WHEN db_functions_with_live_progression_update = 0 THEN 'PASS' ELSE 'FAIL' END,
    'non-gate DB functions containing UPDATE competition_entries + progression_decision = ' || db_functions_with_live_progression_update::text
  FROM facts;
$$;

REVOKE ALL ON FUNCTION public.get_judging_live_tag_progression_invariant_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_judging_live_tag_progression_invariant_admin() TO authenticated;