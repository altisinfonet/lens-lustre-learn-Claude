-- Phase 4: Per-Photo Decision Aggregation
-- Single source of truth for per-photo consensus, used by:
--   - complete-round edge function (entry-level rollup via per-photo)
--   - usePhotoDecisions client hook (UI badges)
-- Mirrors SOW priority tie-break used in complete-round/aggregateEntryDecision.
--
-- Returns one row per (entry_id, photo_index, round_number) with:
--   - decision         : winning decision after majority + SOW tie-break
--   - judges_decided   : how many judges decided this photo in this round
--   - total_judges     : assigned judges (distributed: per-entry; pooled: per-comp)
--   - ratio            : judges_decided_for_winner / total_judges
--   - threshold        : threshold used (from judging_config; default 0.5)
--   - has_consensus    : ratio > threshold AND judges_decided >= min_judges
--   - status           : resolved per-photo participant-facing status
--                        ('submitted','round1_qualified','shortlisted','needs_review',
--                         'rejected','round2_qualified','finalist','winner','pending_consensus')
--
-- Privacy: SECURITY DEFINER + explicit caller-role gate. Returns rows ONLY for
-- entries the caller is allowed to see (admin / judge-assigned-to-comp / entry-owner).
-- Never exposes judge identities — only aggregates.

CREATE OR REPLACE FUNCTION public.get_per_photo_consensus(
  p_entry_ids uuid[]
)
RETURNS TABLE (
  entry_id        uuid,
  photo_index     integer,
  round_number    integer,
  decision        text,
  judges_decided  integer,
  total_judges    integer,
  ratio           numeric,
  threshold       numeric,
  has_consensus   boolean,
  status          text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  -- Auth gate
  IF v_caller IS NULL THEN
    RETURN;  -- empty
  END IF;

  v_is_admin := public.has_role(v_caller, 'admin'::app_role)
             OR public.has_role(v_caller, 'super_admin'::app_role);

  RETURN QUERY
  WITH
  -- Restrict to entries the caller may see.
  visible_entries AS (
    SELECT ce.id, ce.competition_id, ce.user_id, ce.judge_assignment_mode_resolved
    FROM (
      SELECT
        e.id, e.competition_id, e.user_id,
        c.judge_assignment_mode AS judge_assignment_mode_resolved
      FROM public.competition_entries e
      JOIN public.competitions c ON c.id = e.competition_id
      WHERE e.id = ANY(p_entry_ids)
    ) ce
    WHERE
      v_is_admin
      OR ce.user_id = v_caller
      OR EXISTS (
        SELECT 1 FROM public.competition_judges cj
        WHERE cj.competition_id = ce.competition_id AND cj.judge_id = v_caller
      )
  ),
  -- All decisions for these entries.
  decs AS (
    SELECT jd.entry_id, jd.photo_index, jd.round_number, jd.decision, jd.judge_id
    FROM public.judge_decisions jd
    JOIN visible_entries ve ON ve.id = jd.entry_id
  ),
  -- SOW priority lookup (must match complete-round/aggregateEntryDecision).
  priority(decision, prio) AS (
    VALUES
      ('shortlist'::text,   60),
      ('shortlisted'::text, 60),
      ('qualified'::text,   50),
      ('winner'::text,      55),
      ('finalist'::text,    45),
      ('accept'::text,      40),
      ('needs_review'::text,30),
      ('skip'::text,        20),
      ('reject'::text,      10),
      ('rejected'::text,    10)
  ),
  -- Counts per (entry, photo, round, decision).
  counts AS (
    SELECT entry_id, photo_index, round_number, decision, COUNT(*)::int AS n
    FROM decs
    GROUP BY entry_id, photo_index, round_number, decision
  ),
  -- Pick winner per (entry, photo, round) by (count DESC, sow_priority DESC).
  ranked AS (
    SELECT
      c.entry_id, c.photo_index, c.round_number, c.decision, c.n,
      ROW_NUMBER() OVER (
        PARTITION BY c.entry_id, c.photo_index, c.round_number
        ORDER BY c.n DESC, COALESCE(p.prio, 0) DESC, c.decision ASC
      ) AS rn
    FROM counts c
    LEFT JOIN priority p ON p.decision = c.decision
  ),
  winners AS (
    SELECT entry_id, photo_index, round_number, decision AS win_decision, n AS win_count
    FROM ranked WHERE rn = 1
  ),
  -- Total judges per entry: distributed → per-entry assignments; pooled → per-competition.
  judges_for_entry AS (
    SELECT
      ve.id AS entry_id,
      CASE
        WHEN ve.judge_assignment_mode_resolved = 'distributed' THEN
          (SELECT COUNT(*)::int FROM public.judge_entry_assignments jea
            WHERE jea.entry_id = ve.id)
        ELSE
          (SELECT COUNT(*)::int FROM public.competition_judges cj
            WHERE cj.competition_id = ve.competition_id)
      END AS total_judges
    FROM visible_entries ve
  ),
  -- Decisions cast per (entry, photo, round) — i.e. distinct judges who voted.
  decided_per_photo AS (
    SELECT entry_id, photo_index, round_number,
           COUNT(DISTINCT judge_id)::int AS judges_decided
    FROM decs
    GROUP BY entry_id, photo_index, round_number
  ),
  -- Threshold + min_judges per (comp, round) from judging_config.
  cfg AS (
    SELECT competition_id, round_number,
           COALESCE(threshold, 0.5)  AS threshold,
           COALESCE(min_judges, 1)   AS min_judges
    FROM public.judging_config
  )
  SELECT
    w.entry_id,
    w.photo_index,
    w.round_number,
    w.win_decision AS decision,
    dp.judges_decided,
    GREATEST(jfe.total_judges, 1) AS total_judges,
    ROUND( (w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric, 4) AS ratio,
    COALESCE(c.threshold, 0.5) AS threshold,
    (
      (w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(c.threshold, 0.5)
      AND dp.judges_decided >= COALESCE(c.min_judges, 1)
    ) AS has_consensus,
    -- Resolved per-photo status (mirrors derivePhotoStatus, no silent default)
    CASE
      WHEN NOT (
        (w.win_count::numeric) / GREATEST(jfe.total_judges, 1)::numeric > COALESCE(c.threshold, 0.5)
        AND dp.judges_decided >= COALESCE(c.min_judges, 1)
      ) THEN 'pending_consensus'
      WHEN w.round_number = 4 AND w.win_decision = 'winner' THEN 'winner'
      WHEN w.round_number = 4 AND w.win_decision = 'finalist' THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision = 'qualified' THEN 'finalist'
      WHEN w.round_number = 3 AND w.win_decision IN ('reject','rejected') THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision = 'shortlist' THEN 'round2_qualified'
      WHEN w.round_number = 2 AND w.win_decision IN ('skip','reject','rejected') THEN 'rejected'
      WHEN w.round_number = 2 AND w.win_decision = 'needs_review' THEN 'needs_review'
      WHEN w.round_number = 2 AND w.win_decision = 'qualified' THEN 'round2_qualified'
      WHEN w.round_number = 1 AND w.win_decision = 'accept' THEN 'round1_qualified'
      WHEN w.round_number = 1 AND w.win_decision = 'shortlist' THEN 'shortlisted'
      WHEN w.round_number = 1 AND w.win_decision = 'needs_review' THEN 'needs_review'
      WHEN w.round_number = 1 AND w.win_decision IN ('reject','rejected') THEN 'rejected'
      ELSE 'pending_consensus'
    END AS status
  FROM winners w
  JOIN visible_entries ve  ON ve.id = w.entry_id
  JOIN judges_for_entry jfe ON jfe.entry_id = w.entry_id
  JOIN decided_per_photo dp ON dp.entry_id = w.entry_id
                            AND dp.photo_index = w.photo_index
                            AND dp.round_number = w.round_number
  LEFT JOIN cfg c ON c.competition_id = ve.competition_id AND c.round_number = w.round_number
  ORDER BY w.entry_id, w.photo_index, w.round_number;
END;
$$;

REVOKE ALL ON FUNCTION public.get_per_photo_consensus(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_per_photo_consensus(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_per_photo_consensus(uuid[]) IS
'Phase 4 — Single source of truth for per-photo consensus. Applies SOW priority tie-break (shortlist>winner>qualified>finalist>accept>needs_review>skip>reject). Returns pending_consensus when threshold not met. Privacy: caller must be admin, owner, or assigned judge.';