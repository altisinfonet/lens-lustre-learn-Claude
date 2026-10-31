-- ============================================================
-- SAFE-MICRO BATCH — B1.7 Phase 1 (pure functions only)
-- NO triggers. NO writers. NO data mutation. NO side effects.
-- ============================================================

-- 1) Pure derivation function (IMMUTABLE, no I/O)
CREATE OR REPLACE FUNCTION public.derive_status_from_stage_key(_stage_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE _stage_key
    -- Round 1
    WHEN 'r1_accepted'            THEN 'round1_qualified'
    WHEN 'r1_shortlisted_r2'      THEN 'shortlisted'
    WHEN 'r1_needs_verification'  THEN 'needs_review'
    WHEN 'r1_rejected'            THEN 'rejected'
    WHEN 'r1_needs_review'        THEN 'needs_review'
    -- Round 2  (Q-V4a: r2_accept → round1_qualified per approved mapping)
    WHEN 'r2_accepted'            THEN 'round1_qualified'
    WHEN 'r2_qualified_r3'        THEN 'round2_qualified'
    WHEN 'r2_not_selected_r3'     THEN 'rejected'
    -- Round 3  (Q-V4a: r3_accept → round2_qualified per approved mapping)
    WHEN 'r3_accepted'            THEN 'round2_qualified'
    WHEN 'r3_qualified_final'     THEN 'finalist'
    WHEN 'r3_not_selected_final'  THEN 'rejected'
    -- Round 4  (Q-V4b: all non-winner R4 awards collapse to finalist)
    WHEN 'r4_winner'              THEN 'winner'
    WHEN 'r4_runner_up_1'         THEN 'finalist'
    WHEN 'r4_runner_up_2'         THEN 'finalist'
    WHEN 'r4_honorary_mention'    THEN 'finalist'
    WHEN 'r4_special_jury'        THEN 'finalist'
    WHEN 'r4_top_50'              THEN 'finalist'
    WHEN 'r4_top_100'             THEN 'finalist'
    WHEN 'r4_finalist'            THEN 'finalist'
    WHEN 'r4_qualified_final'     THEN 'finalist'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.derive_status_from_stage_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_status_from_stage_key(text) TO authenticated, service_role;

-- 2) Read-only drift audit (admin-only, SECURITY DEFINER, STABLE)
CREATE OR REPLACE FUNCTION public.get_status_stage_key_drift_admin()
RETURNS TABLE(entry_id uuid, stage_key text, status text, derived text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, stage_key, status::text, public.derive_status_from_stage_key(stage_key)
    FROM public.competition_entries
   WHERE stage_key IS NOT NULL
     AND status::text IS DISTINCT FROM public.derive_status_from_stage_key(stage_key);
$$;

REVOKE ALL ON FUNCTION public.get_status_stage_key_drift_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_status_stage_key_drift_admin() TO authenticated;