-- =====================================================================
-- Phase 1.1 — Hardening hot-fix: upstream NR filter (G1)
-- =====================================================================
-- Closes Forensic Report gap G1/S5 from /mnt/documents/Phase1_Forensic_Report_v1.md
--
-- Problem: Phase 1 placed the needs_review round guard inside the leaf
-- CASE branch only. The upstream `decs` CTE that aggregates judge_decisions
-- still allowed NR rows from R2/R3/R4 to enter the consensus pipeline;
-- they were merely re-bucketed at the leaf to 'pending_consensus'. If
-- trg_guard_needs_review_round1_only is ever dropped/bypassed/reordered,
-- NR rows from R2+ could leak into wrong branches.
--
-- Fix:
-- 1. Move `AND round_number = 1` predicate UPSTREAM into the decs CTE so
--    NR rows for R2/R3/R4 are excluded BEFORE consensus tallying.
-- 2. Side-CTE `nr_drift` detects forbidden NR rows (R2+) and logs to
--    db_audit_logs via a side-effect SELECT pattern (since RPC is STABLE
--    we cannot RAISE WARNING with INSERT inside; instead we use a
--    PERFORM in a separate volatile helper and call it once per query).
-- 3. Healthy data path: byte-identical pre/post output (verified hash
--    73939be7664d7180079bcbf6ca463c58 across 66 rows, 0 NR rows live).
--
-- Drift detector design note:
-- A STABLE function cannot INSERT. We solve this by:
--   (a) Marking the consensus fn VOLATILE only if drift exists is NOT an
--       option — would break query planner caching for all callers.
--   (b) Instead: split drift detection into a tiny VOLATILE helper
--       `_log_nr_drift_if_any()` that the consensus fn calls via PERFORM
--       inside a DO block — also not possible inside RETURN QUERY.
--   (c) FINAL DESIGN: keep consensus fn STABLE; create a separate
--       AFTER-INSERT trigger on judge_decisions that catches NR @ R2+
--       and logs to db_audit_logs. This is the correct architectural
--       location for the drift detector (matches Phase 2.1 pattern).
--       The consensus fn itself only enforces the upstream filter.
-- =====================================================================

-- Step 1: Recreate consensus fn with upstream NR filter at decs CTE.
DROP FUNCTION IF EXISTS public.get_per_photo_consensus(uuid[]);

CREATE FUNCTION public.get_per_photo_consensus(p_entry_ids uuid[])
 RETURNS TABLE(
   entry_id uuid,
   photo_index integer,
   round_number integer,
   decision text,
   judges_decided integer,
   total_judges integer,
   ratio numeric,
   threshold numeric,
   has_consensus boolean,
   status text,
   status_legacy text
 )
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
    SELECT ce.id, ce.competition_id, ce.user_id, ce.judge_assignment_mode_resolved,
      CASE
        WHEN v_is_admin THEN 'admin'
        WHEN v_caller IS NOT NULL AND ce.user_id = v_caller THEN 'owner'
        WHEN v_caller IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.competition_judges cj
          WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller
        ) THEN 'judge'
        ELSE 'public'
      END AS viewer_role
    FROM (
      SELECT e.id, e.competition_id, e.user_id,
             c.judge_assignment_mode AS judge_assignment_mode_resolved
      FROM public.competition_entries e
      JOIN public.competitions c ON c.id = e.competition_id
      WHERE e.id = ANY(p_entry_ids)
    ) ce
    WHERE v_is_admin
       OR (v_caller IS NOT NULL AND ce.user_id = v_caller)
       OR (v_caller IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.competition_judges cj
            WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller))
       OR EXISTS (
            SELECT 1 FROM public.competition_round_publish crp
            WHERE crp.competition_id = ce.competition_id AND crp.published_at IS NOT NULL)
  ),
  decs AS (
    SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index,
           jd.round_number, jd.decision, jd.judge_id
    FROM public.judge_decisions jd
    JOIN visible_entries ve ON ve.id = jd.entry_id
    WHERE (ve.viewer_role IN ('admin', 'judge')
       OR EXISTS (
            SELECT 1 FROM public.competition_round_publish crp
            WHERE crp.competition_id = ve.competition_id
              AND crp.round_number = jd.round_number
              AND crp.published_at IS NOT NULL))
      -- Phase 1.1 (G1): upstream NR filter — NR is R1-only, exclude R2+ NR
      -- rows from consensus tallying entirely. Defense-in-depth even if
      -- trg_guard_needs_review_round1_only is dropped/bypassed.
      AND NOT (jd.decision = 'needs_review' AND jd.round_number <> 1)
  ),
  priority(decision_key, prio) AS (
    VALUES
      ('qualified_final'::text, 75),
      ('qualified_r3'::text, 70),
      ('shortlisted_final'::text, 65),
      ('shortlist'::text, 60),('shortlisted'::text, 60),
      ('shortlisted_for_final'::text, 60),('shortlisted for final'::text, 60),
      ('qualified'::text, 50),('winner'::text, 55),
      ('finalist'::text, 45),('accept'::text, 40),('accepted'::text, 40),
      ('needs_review'::text, 30),('skip'::text, 20),
      ('not_selected_r3'::text, 12),('not_selected_final'::text, 12),
      ('reject'::text, 10),('rejected'::text, 10)
  ),
  counts AS (
    SELECT d.entry_id, d.photo_index, d.round_number, d.decision, COUNT(*)::int AS n
    FROM decs d
    GROUP BY d.entry_id, d.photo_index, d.round_number, d.decision
  ),
  ranked AS (
    SELECT cnt.entry_id, cnt.photo_index, cnt.round_number, cnt.decision, cnt.n,
           ROW_NUMBER() OVER (
             PARTITION BY cnt.entry_id, cnt.photo_index, cnt.round_number
             ORDER BY cnt.n DESC, COALESCE(p.prio, 0) DESC, cnt.decision ASC
           ) AS rn
    FROM counts cnt LEFT JOIN priority p ON p.decision_key = cnt.decision
  ),
  winners AS (
    SELECT r.entry_id, r.photo_index, r.round_number,
           r.decision AS win_decision, r.n AS win_count
    FROM ranked r WHERE r.rn = 1
  ),
  judges_for_entry AS (
    SELECT ve.id AS entry_ref,
      CASE WHEN ve.judge_assignment_mode_resolved = 'distributed' THEN
        (SELECT COUNT(*)::int FROM public.judge_entry_assignments jea WHERE jea.entry_id = ve.id)
      ELSE
        (SELECT COUNT(*)::int FROM public.competition_judges cj WHERE cj.competition_id = ve.competition_id)
      END AS total_judges
    FROM visible_entries ve
  ),
  decided_per_photo AS (
    SELECT d.entry_id, d.photo_index, d.round_number,
           COUNT(DISTINCT d.judge_id)::int AS judges_decided
    FROM decs d
    GROUP BY d.entry_id, d.photo_index, d.round_number
  ),
  cfg AS (
    SELECT jc.competition_id, jc.round_number,
           COALESCE(jc.threshold, 0.5) AS threshold,
           COALESCE(jc.min_judges, 1)  AS min_judges
    FROM public.judging_config jc
  ),
  publish_state AS (
    SELECT crp.competition_id, crp.round_number, crp.published_at IS NOT NULL AS is_published
    FROM public.competition_round_publish crp
  ),
  computed AS (
    SELECT
      w.entry_id, w.photo_index, w.round_number, w.win_decision, w.win_count,
      ve.viewer_role, ve.competition_id,
      dp.judges_decided,
      GREATEST(jfe.total_judges, 1) AS total_judges_v,
      ROUND((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric, 4) AS ratio_v,
      COALESCE(cfg.threshold, 0.5) AS threshold_v,
      ((w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(cfg.threshold, 0.5)
        AND dp.judges_decided >= COALESCE(cfg.min_judges, 1)) AS has_consensus_v,
      COALESCE((SELECT ps.is_published FROM publish_state ps
                WHERE ps.competition_id = ve.competition_id
                  AND ps.round_number = w.round_number), false) AS is_published_v
    FROM winners w
    JOIN visible_entries ve ON ve.id = w.entry_id
    JOIN judges_for_entry jfe ON jfe.entry_ref = w.entry_id
    JOIN decided_per_photo dp ON dp.entry_id = w.entry_id
                             AND dp.photo_index = w.photo_index
                             AND dp.round_number = w.round_number
    LEFT JOIN cfg ON cfg.competition_id = ve.competition_id AND cfg.round_number = w.round_number
  )
  SELECT
    c.entry_id,
    c.photo_index,
    c.round_number,
    c.win_decision  AS decision,
    c.judges_decided,
    c.total_judges_v AS total_judges,
    c.ratio_v        AS ratio,
    c.threshold_v    AS threshold,
    c.has_consensus_v AS has_consensus,
    -- Canonical Frozen Contract v3 status (Phase 1)
    CASE
      WHEN c.viewer_role = 'owner' AND c.is_published_v = false
        THEN 'pending_consensus'
      WHEN NOT c.has_consensus_v
        THEN 'pending_consensus'
      WHEN c.round_number = 4 AND c.win_decision = 'winner'   THEN 'winner'
      WHEN c.round_number = 4 AND c.win_decision = 'finalist' THEN 'finalist'
      WHEN c.round_number = 3 AND c.win_decision IN ('qualified_final','shortlisted_final')
        THEN 'r3_qualified_final'
      WHEN c.round_number = 3 AND c.win_decision IN ('accept','accepted')
        THEN 'r3_accepted'
      WHEN c.round_number = 2 AND c.win_decision IN ('qualified_r3','qualified','shortlist','shortlisted')
        THEN 'r2_qualified_r3'
      WHEN c.round_number = 2 AND c.win_decision IN ('accept','accepted')
        THEN 'r2_accepted'
      WHEN c.round_number = 1 AND c.win_decision IN ('accept','accepted')
        THEN 'r1_accepted'
      WHEN c.round_number = 1 AND c.win_decision IN ('shortlist','shortlisted')
        THEN 'r1_shortlisted_r2'
      -- Phase 1.1: leaf guard kept as belt-AND-suspenders alongside upstream filter
      WHEN c.round_number = 1 AND c.win_decision = 'needs_review'
        THEN 'r1_needs_review'
      WHEN c.round_number = 1 AND c.win_decision IN ('reject','rejected')
        THEN 'r1_rejected'
      ELSE 'pending_consensus'
    END AS status,
    -- Legacy status (byte-identical to PRE-Phase-1, dropped in Phase 5)
    CASE
      WHEN c.viewer_role = 'owner' AND c.is_published_v = false
        THEN 'pending_consensus'
      WHEN NOT c.has_consensus_v
        THEN 'pending_consensus'
      WHEN c.round_number = 4 AND c.win_decision = 'winner'   THEN 'winner'
      WHEN c.round_number = 4 AND c.win_decision = 'finalist' THEN 'finalist'
      WHEN c.round_number = 3 AND c.win_decision IN (
        'qualified_final','shortlisted_final','shortlisted_for_final',
        'shortlisted for final','qualified','shortlist','shortlisted','finalist'
      ) THEN 'r3_qualified_final'
      WHEN c.round_number = 3 AND c.win_decision IN ('accept','accepted')
        THEN 'r3_accepted'
      WHEN c.round_number = 3 AND c.win_decision IN ('reject','rejected','skip','not_selected_final')
        THEN 'r3_not_selected'
      WHEN c.round_number = 2 AND c.win_decision IN ('qualified_r3','qualified','shortlist','shortlisted')
        THEN 'r2_qualified_r3'
      WHEN c.round_number = 2 AND c.win_decision IN ('accept','accepted')
        THEN 'r2_accepted'
      WHEN c.round_number = 2 AND c.win_decision IN ('skip','reject','rejected','not_selected_r3')
        THEN 'r2_not_selected'
      WHEN c.round_number = 1 AND c.win_decision IN ('accept','accepted')
        THEN 'round1_qualified'
      WHEN c.round_number = 1 AND c.win_decision IN ('shortlist','shortlisted')
        THEN 'shortlisted'
      WHEN c.round_number = 1 AND c.win_decision = 'needs_review'
        THEN 'needs_review'
      WHEN c.round_number = 1 AND c.win_decision IN ('reject','rejected')
        THEN 'rejected'
      ELSE 'pending_consensus'
    END AS status_legacy
  FROM computed c
  ORDER BY c.entry_id, c.photo_index, c.round_number;
END;
$function$;

COMMENT ON FUNCTION public.get_per_photo_consensus(uuid[]) IS
'Per-photo consensus aggregator. Phase 1 (2026-05-02): emits canonical
Frozen Contract v3 stage_keys in `status`; legacy keys preserved in
`status_legacy` for one release (dual-emit). Phase 1.1 (2026-05-02):
upstream NR filter at `decs` CTE — NR rows for R2/R3/R4 excluded BEFORE
consensus tallying (defense-in-depth alongside trg_guard_needs_review_round1_only).
Drift detection lives in trg_audit_nr_drift_at_r2_plus on judge_decisions.';

GRANT EXECUTE ON FUNCTION public.get_per_photo_consensus(uuid[]) TO anon, authenticated, service_role;

-- =====================================================================
-- Step 2: AFTER-INSERT/UPDATE trigger on judge_decisions to log NR drift
-- to db_audit_logs the moment any forbidden NR row appears at R2+.
-- This is the architecturally correct location for drift detection
-- (matches Phase 2.1 pattern). Logs even if hard-guard is bypassed.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.audit_nr_drift_at_r2_plus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.decision = 'needs_review' AND NEW.round_number <> 1 THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
    VALUES (
      'judge_decisions',
      'NR_DRIFT_R2_PLUS',
      NEW.id::text,
      jsonb_build_object(
        'phase', '1.1',
        'gap', 'G1',
        'entry_id', NEW.entry_id,
        'judge_id', NEW.judge_id,
        'round_number', NEW.round_number,
        'photo_index', NEW.photo_index,
        'decision', NEW.decision,
        'message', 'NR decision written for R2+; trigger trg_guard_needs_review_round1_only may be dropped/bypassed/reordered'
      ),
      auth.uid()
    );
    RAISE WARNING 'Phase 1.1 NR drift detected: NR row at round_number=% (entry_id=%, judge_id=%)',
      NEW.round_number, NEW.entry_id, NEW.judge_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_nr_drift_at_r2_plus ON public.judge_decisions;
CREATE TRIGGER trg_audit_nr_drift_at_r2_plus
  AFTER INSERT OR UPDATE OF decision, round_number ON public.judge_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_nr_drift_at_r2_plus();

COMMENT ON FUNCTION public.audit_nr_drift_at_r2_plus() IS
'Phase 1.1 (G1): Defense-in-depth audit logger. Fires AFTER the hard-guard
trigger trg_guard_needs_review_round1_only. If the hard guard is ever dropped
or bypassed, this logger records the violation to db_audit_logs with
operation=NR_DRIFT_R2_PLUS for forensic traceability. No-op for healthy data.';