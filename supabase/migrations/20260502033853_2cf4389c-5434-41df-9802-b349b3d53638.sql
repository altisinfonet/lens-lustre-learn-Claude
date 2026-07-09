-- ============================================================================
-- Admin audit: judge UI eligible photos vs DB gate requirements per round/entry
-- ----------------------------------------------------------------------------
-- Mirrors the EXACT predicates used by:
--   * supabase/functions/complete-round  (lock gate)
--   * supabase/functions/publish-round   (declare gate, R4 verification)
--   * src/hooks/judging/useJudgeClassicData.ts -> get_round_eligible_photos
--
-- Returns one row per (competition_id, round_number, entry_id) with the
-- eligible-photo cardinality on the judge-UI side and the gate-deltas on
-- the DB side, plus small samples so admins can jump straight to the
-- offending (judge, entry, photo) tuples.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_round_judging_gate_admin(
  _competition_id uuid,
  _round_number   integer
)
RETURNS TABLE (
  competition_id              uuid,
  round_number                integer,
  entry_id                    uuid,
  entry_title                 text,
  entry_status                text,
  total_photos                integer,
  ui_eligible_photos          integer,
  ui_eligible_photo_indices   integer[],
  assigned_judges             integer,
  expected_decisions          integer,
  present_decisions           integer,
  missing_decisions           integer,
  missing_decision_sample     jsonb,
  expected_scores             integer,
  missing_scores              integer,
  missing_score_sample        jsonb,
  verification_pending        boolean,
  ready_to_lock               boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_distributed boolean;
BEGIN
  -- Admin-only — same guard pattern as every other admin audit RPC.
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF _round_number IS NULL OR _round_number < 1 OR _round_number > 4 THEN
    RAISE EXCEPTION 'round_number must be between 1 and 4';
  END IF;

  SELECT (c.judge_assignment_mode = 'distributed')
    INTO v_is_distributed
  FROM public.competitions c
  WHERE c.id = _competition_id;

  IF v_is_distributed IS NULL THEN
    RAISE EXCEPTION 'competition not found: %', _competition_id;
  END IF;

  RETURN QUERY
  WITH entries AS (
    SELECT
      e.id          AS entry_id,
      e.title       AS entry_title,
      e.status      AS entry_status,
      COALESCE(array_length(e.photos, 1), 0) AS total_photos
    FROM public.competition_entries e
    WHERE e.competition_id = _competition_id
  ),
  -- All photo indices for every entry (0-based, matches photo_index storage)
  all_photos AS (
    SELECT
      en.entry_id,
      gs.pi AS photo_index
    FROM entries en
    CROSS JOIN LATERAL generate_series(0, GREATEST(en.total_photos - 1, 0)) AS gs(pi)
    WHERE en.total_photos > 0
  ),
  -- Judge-UI eligible photo set:
  --   R1 -> every uploaded photo
  --   R2+ -> exactly what get_round_eligible_photos returns (the same RPC the
  --          judge classic data hook calls)
  eligible AS (
    SELECT entry_id, photo_index
    FROM all_photos
    WHERE _round_number = 1
    UNION ALL
    SELECT g.entry_id, g.photo_index
    FROM public.get_round_eligible_photos(_competition_id, _round_number) AS g
    WHERE _round_number >= 2
  ),
  eligible_per_entry AS (
    SELECT
      entry_id,
      COUNT(*)::int                          AS ui_eligible_photos,
      ARRAY_AGG(photo_index ORDER BY photo_index) AS ui_eligible_photo_indices
    FROM eligible
    GROUP BY entry_id
  ),
  -- Assigned judges per entry: distributed -> judge_entry_assignments,
  -- otherwise every competition_judges row applies to every entry.
  comp_judges AS (
    SELECT cj.judge_id
    FROM public.competition_judges cj
    WHERE cj.competition_id = _competition_id
  ),
  judges_per_entry AS (
    SELECT en.entry_id, cj.judge_id
    FROM entries en
    CROSS JOIN comp_judges cj
    WHERE NOT v_is_distributed
    UNION ALL
    SELECT jea.entry_id, jea.judge_id
    FROM public.judge_entry_assignments jea
    WHERE v_is_distributed
      AND jea.competition_id = _competition_id
  ),
  judge_count_per_entry AS (
    SELECT entry_id, COUNT(DISTINCT judge_id)::int AS assigned_judges
    FROM judges_per_entry
    GROUP BY entry_id
  ),
  -- Expected (judge, photo) coverage tuples for this round.
  expected AS (
    SELECT el.entry_id, el.photo_index, jpe.judge_id
    FROM eligible el
    JOIN judges_per_entry jpe ON jpe.entry_id = el.entry_id
  ),
  -- Decisions present: explicit judge_decisions for this round
  --   PLUS, in R1 only, synthesized from judge_tag_assignments (mirrors the
  --   "tag-only judges" path inside complete-round).
  decisions_present AS (
    SELECT jd.entry_id, jd.photo_index, jd.judge_id
    FROM public.judge_decisions jd
    JOIN entries en ON en.entry_id = jd.entry_id
    WHERE jd.round_number = _round_number
    UNION
    SELECT jta.entry_id, jta.photo_index, jta.judge_id
    FROM public.judge_tag_assignments jta
    JOIN entries en ON en.entry_id = jta.entry_id
    WHERE _round_number = 1
      AND (
        jta.round_number = 1
        OR jta.round_number IS NULL  -- legacy rows; complete-round treats them as R1
      )
  ),
  decision_stats AS (
    SELECT
      e.entry_id,
      COUNT(*)::int AS expected_decisions,
      COUNT(dp.judge_id)::int AS present_decisions
    FROM expected e
    LEFT JOIN decisions_present dp
      ON dp.entry_id = e.entry_id
     AND dp.photo_index = e.photo_index
     AND dp.judge_id = e.judge_id
    GROUP BY e.entry_id
  ),
  missing_decision_rows AS (
    SELECT e.entry_id, e.photo_index, e.judge_id
    FROM expected e
    LEFT JOIN decisions_present dp
      ON dp.entry_id = e.entry_id
     AND dp.photo_index = e.photo_index
     AND dp.judge_id = e.judge_id
    WHERE dp.judge_id IS NULL
  ),
  missing_decision_sample AS (
    SELECT
      entry_id,
      jsonb_agg(
        jsonb_build_object(
          'judge_id', judge_id,
          'photo_index', photo_index
        )
        ORDER BY photo_index, judge_id
      ) FILTER (WHERE rn <= 20) AS sample
    FROM (
      SELECT
        entry_id, photo_index, judge_id,
        ROW_NUMBER() OVER (PARTITION BY entry_id ORDER BY photo_index, judge_id) AS rn
      FROM missing_decision_rows
    ) s
    GROUP BY entry_id
  ),
  -- 10-criteria score coverage gate (R2/R3/R4 only) — same 10 SOW columns
  -- as supabase/functions/complete-round/index.ts.
  scores_present AS (
    SELECT js.entry_id, js.photo_index, js.judge_id
    FROM public.judge_scores js
    JOIN entries en ON en.entry_id = js.entry_id
    WHERE _round_number >= 2
      AND js.round_number = _round_number
      AND js.line_score          IS NOT NULL
      AND js.shape_score         IS NOT NULL
      AND js.form_score          IS NOT NULL
      AND js.texture_score       IS NOT NULL
      AND js.color_palette_score IS NOT NULL
      AND js.space_score         IS NOT NULL
      AND js.tone_score          IS NOT NULL
      AND js.balance_score       IS NOT NULL
      AND js.light_score         IS NOT NULL
      AND js.depth_score         IS NOT NULL
  ),
  score_stats AS (
    SELECT
      e.entry_id,
      COUNT(*)::int AS expected_scores,
      COUNT(*)::int - COUNT(sp.judge_id)::int AS missing_scores
    FROM expected e
    LEFT JOIN scores_present sp
      ON sp.entry_id = e.entry_id
     AND sp.photo_index = e.photo_index
     AND sp.judge_id = e.judge_id
    WHERE _round_number >= 2
    GROUP BY e.entry_id
  ),
  missing_score_rows AS (
    SELECT e.entry_id, e.photo_index, e.judge_id
    FROM expected e
    LEFT JOIN scores_present sp
      ON sp.entry_id = e.entry_id
     AND sp.photo_index = e.photo_index
     AND sp.judge_id = e.judge_id
    WHERE _round_number >= 2
      AND sp.judge_id IS NULL
  ),
  missing_score_sample AS (
    SELECT
      entry_id,
      jsonb_agg(
        jsonb_build_object(
          'judge_id', judge_id,
          'photo_index', photo_index
        )
        ORDER BY photo_index, judge_id
      ) FILTER (WHERE rn <= 20) AS sample
    FROM (
      SELECT
        entry_id, photo_index, judge_id,
        ROW_NUMBER() OVER (PARTITION BY entry_id ORDER BY photo_index, judge_id) AS rn
      FROM missing_score_rows
    ) s
    GROUP BY entry_id
  )
  SELECT
    _competition_id                           AS competition_id,
    _round_number                             AS round_number,
    en.entry_id,
    en.entry_title,
    en.entry_status,
    en.total_photos,
    COALESCE(epe.ui_eligible_photos, 0)       AS ui_eligible_photos,
    COALESCE(epe.ui_eligible_photo_indices, ARRAY[]::int[]) AS ui_eligible_photo_indices,
    COALESCE(jc.assigned_judges, 0)           AS assigned_judges,
    COALESCE(ds.expected_decisions, 0)        AS expected_decisions,
    COALESCE(ds.present_decisions, 0)         AS present_decisions,
    COALESCE(ds.expected_decisions, 0) - COALESCE(ds.present_decisions, 0)
                                              AS missing_decisions,
    COALESCE(mds.sample, '[]'::jsonb)         AS missing_decision_sample,
    CASE WHEN _round_number >= 2 THEN COALESCE(ss.expected_scores, 0) ELSE 0 END
                                              AS expected_scores,
    CASE WHEN _round_number >= 2 THEN COALESCE(ss.missing_scores, 0) ELSE 0 END
                                              AS missing_scores,
    COALESCE(mss.sample, '[]'::jsonb)         AS missing_score_sample,
    CASE
      WHEN _round_number = 4
        THEN public.any_photo_pending(en.entry_id, _round_number)
      ELSE FALSE
    END                                       AS verification_pending,
    (
      COALESCE(epe.ui_eligible_photos, 0) > 0
      AND (COALESCE(ds.expected_decisions, 0) - COALESCE(ds.present_decisions, 0)) = 0
      AND (CASE WHEN _round_number >= 2 THEN COALESCE(ss.missing_scores, 0) ELSE 0 END) = 0
      AND (
        _round_number <> 4
        OR NOT public.any_photo_pending(en.entry_id, _round_number)
      )
    )                                         AS ready_to_lock
  FROM entries en
  LEFT JOIN eligible_per_entry      epe ON epe.entry_id = en.entry_id
  LEFT JOIN judge_count_per_entry   jc  ON jc.entry_id  = en.entry_id
  LEFT JOIN decision_stats          ds  ON ds.entry_id  = en.entry_id
  LEFT JOIN missing_decision_sample mds ON mds.entry_id = en.entry_id
  LEFT JOIN score_stats             ss  ON ss.entry_id  = en.entry_id
  LEFT JOIN missing_score_sample    mss ON mss.entry_id = en.entry_id
  ORDER BY
    -- mismatches first so admins see them at the top
    (
      COALESCE(epe.ui_eligible_photos, 0) > 0
      AND (COALESCE(ds.expected_decisions, 0) - COALESCE(ds.present_decisions, 0)) = 0
      AND (CASE WHEN _round_number >= 2 THEN COALESCE(ss.missing_scores, 0) ELSE 0 END) = 0
      AND (_round_number <> 4 OR NOT public.any_photo_pending(en.entry_id, _round_number))
    ) ASC,
    en.entry_title NULLS LAST,
    en.entry_id;
END;
$$;

-- Lock down: revoke from anon/authenticated; keep service_role for back-ops.
REVOKE ALL ON FUNCTION public.get_round_judging_gate_admin(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_round_judging_gate_admin(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_round_judging_gate_admin(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_judging_gate_admin(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.get_round_judging_gate_admin(uuid, integer) IS
  'Admin-only forensic audit. Returns per-entry comparison of judge-UI eligible photos vs the DB gate requirements (decisions, 10-criteria scores, R4 verification) used by complete-round / publish-round. Read-only.';