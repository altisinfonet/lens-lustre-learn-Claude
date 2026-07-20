-- PERMFIX (2026-07-20): rejected entries must never be counted by a judging gate.
-- Root cause: eligibility keyed off per-photo photo_meta.rejected but not the
-- entry-level status, so a wholly-rejected entry's shortlisted photos kept being
-- demanded from judges → UI↔DB parity drift froze 'Complete Round'.
-- Fix: apply one rule everywhere — status <> 'rejected' — and add an invariant
-- guardrail (rejected_entry_gate_leak) that flags any regression.
-- Functions are CREATE OR REPLACE (idempotent); matches what is live.

-- ===================== get_round_judging_gate_self =====================
CREATE OR REPLACE FUNCTION public.get_round_judging_gate_self(_competition_id uuid, _round_number integer)
 RETURNS TABLE(competition_id uuid, round_number integer, entry_id uuid, entry_title text, total_photos integer, ui_eligible_photo_indices integer[], ui_eligible_photos integer, my_decisions_present integer, my_decisions_missing integer, my_scores_missing integer, ready_to_complete boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _caller_id    UUID := auth.uid();
  _is_admin     BOOLEAN;
  _is_judge     BOOLEAN;
  _is_dist      BOOLEAN;
BEGIN
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be authenticated';
  END IF;

  SELECT public.has_role(_caller_id, 'admin') INTO _is_admin;

  -- Is the caller an assigned judge for this competition?
  SELECT EXISTS (
    SELECT 1 FROM public.competition_judges
    WHERE competition_id = _competition_id
      AND judge_id       = _caller_id
  ) INTO _is_judge;

  IF NOT (_is_admin OR _is_judge) THEN
    RAISE EXCEPTION 'Forbidden: not an assigned judge for this competition';
  END IF;

  -- Distributed-mode flag (per-entry assignment)
  SELECT (judge_assignment_mode = 'distributed')
    INTO _is_dist
    FROM public.competitions
   WHERE id = _competition_id;
  _is_dist := COALESCE(_is_dist, FALSE);

  RETURN QUERY
  WITH
  -- Step 1: resolve caller's assigned entries.
  -- In distributed mode, restrict to judge_entry_assignments.
  -- Otherwise the judge is responsible for every entry in the comp.
  my_entries AS (
    SELECT
      e.id           AS entry_id,
      e.title        AS entry_title,
      e.photos,
      e.photo_meta,
      COALESCE(array_length(e.photos, 1), 1) AS total_photos
    FROM public.competition_entries e
    WHERE e.competition_id = _competition_id
      AND e.status <> 'rejected'          -- PERMFIX: rejected entries are out of the judging surface
      AND (
        _is_admin
        OR NOT _is_dist
        OR EXISTS (
          SELECT 1 FROM public.judge_entry_assignments jea
          WHERE jea.competition_id = _competition_id
            AND jea.entry_id       = e.id
            AND jea.judge_id       = _caller_id
        )
      )
  ),
  -- Step 2: per-photo eligibility.
  -- R1 → every non-rejected photo of every assigned entry.
  -- R2+ → only photos that the judge personally shortlisted in round N-1.
  --       This mirrors the edge fn's `fetchEligiblePhotoKeys` exactly, scoped
  --       to the caller (instead of "any judge" for the admin-side audit).
  exploded AS (
    SELECT
      m.entry_id,
      m.entry_title,
      m.total_photos,
      gs.pi AS photo_index,
      COALESCE((m.photo_meta -> gs.pi ->> 'rejected')::boolean, FALSE) AS is_rejected
    FROM my_entries m
    CROSS JOIN LATERAL generate_series(0, m.total_photos - 1) AS gs(pi)
  ),
  eligible AS (
    SELECT
      x.entry_id,
      x.entry_title,
      x.total_photos,
      x.photo_index
    FROM exploded x
    WHERE x.is_rejected = FALSE
      AND (
        _round_number = 1
        OR EXISTS (
          SELECT 1 FROM public.judge_decisions jd
          WHERE jd.entry_id     = x.entry_id
            AND jd.photo_index  = x.photo_index
            AND jd.round_number = _round_number - 1
            AND jd.judge_id     = _caller_id
            AND lower(trim(jd.decision)) = ANY (
              CASE _round_number - 1
                WHEN 1 THEN ARRAY['shortlist','shortlisted']
                WHEN 2 THEN ARRAY['qualified_r3','shortlist','shortlisted','qualified','qualified_for_r3','qualified for r3']
                WHEN 3 THEN ARRAY['qualified_final','shortlisted_final','qualified','shortlist','shortlisted','finalist','shortlisted_for_final','shortlisted for final']
                ELSE ARRAY[]::text[]
              END
            )
        )
      )
  ),
  per_entry AS (
    SELECT
      el.entry_id,
      el.entry_title,
      el.total_photos,
      array_agg(el.photo_index ORDER BY el.photo_index) AS ui_eligible_photo_indices,
      COUNT(*)::int AS ui_eligible_photos
    FROM eligible el
    GROUP BY el.entry_id, el.entry_title, el.total_photos
  ),
  my_dec AS (
    SELECT
      pe.entry_id,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.judge_decisions jd
          WHERE jd.entry_id     = pe.entry_id
            AND jd.judge_id     = _caller_id
            AND jd.round_number = _round_number
            AND jd.photo_index  = ANY (pe.ui_eligible_photo_indices)
        )
      )::int AS dummy
    FROM per_entry pe
    GROUP BY pe.entry_id
  ),
  my_dec_real AS (
    SELECT
      pe.entry_id,
      COUNT(jd.*)::int AS present
    FROM per_entry pe
    LEFT JOIN public.judge_decisions jd
           ON jd.entry_id     = pe.entry_id
          AND jd.judge_id     = _caller_id
          AND jd.round_number = _round_number
          AND jd.photo_index  = ANY (pe.ui_eligible_photo_indices)
    GROUP BY pe.entry_id
  ),
  my_score_missing AS (
    -- For R2/R3/R4, every eligible photo needs a judge_scores row with all 10
    -- SOW criteria non-null. R1 has no score requirement.
    SELECT
      pe.entry_id,
      CASE
        WHEN _round_number = 1 THEN 0
        ELSE pe.ui_eligible_photos - COUNT(js.*) FILTER (
          WHERE js.line_score IS NOT NULL
            AND js.shape_score IS NOT NULL
            AND js.form_score IS NOT NULL
            AND js.texture_score IS NOT NULL
            AND js.color_palette_score IS NOT NULL
            AND js.space_score IS NOT NULL
            AND js.tone_score IS NOT NULL
            AND js.balance_score IS NOT NULL
            AND js.light_score IS NOT NULL
            AND js.depth_score IS NOT NULL
        )::int
      END AS missing
    FROM per_entry pe
    LEFT JOIN public.judge_scores js
           ON js.entry_id     = pe.entry_id
          AND js.judge_id     = _caller_id
          AND js.round_number = _round_number
          AND js.photo_index  = ANY (pe.ui_eligible_photo_indices)
    GROUP BY pe.entry_id, pe.ui_eligible_photos
  )
  SELECT
    _competition_id,
    _round_number,
    pe.entry_id,
    pe.entry_title,
    pe.total_photos,
    pe.ui_eligible_photo_indices,
    pe.ui_eligible_photos,
    md.present                                      AS my_decisions_present,
    GREATEST(pe.ui_eligible_photos - md.present, 0) AS my_decisions_missing,
    GREATEST(msm.missing, 0)                        AS my_scores_missing,
    (
      pe.ui_eligible_photos = md.present
      AND COALESCE(msm.missing, 0) = 0
    ) AS ready_to_complete
  FROM per_entry pe
  LEFT JOIN my_dec_real    md  ON md.entry_id  = pe.entry_id
  LEFT JOIN my_score_missing msm ON msm.entry_id = pe.entry_id
  ORDER BY pe.entry_title NULLS LAST;
END;
$function$


-- ===================== get_round_eligible_photos =====================
CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(_competition_id uuid, _round_number integer)
 RETURNS TABLE(entry_id uuid, photo_index integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Authorization guard. service_role / internal LATERAL callers have auth.jwt() IS NULL
  -- and are permitted to bypass (wrapper RPCs enforce their own auth model).
  IF auth.jwt() IS NOT NULL AND _uid IS NOT NULL THEN
    IF NOT (
      public.has_role(_uid, 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.competition_judges cj
        WHERE cj.judge_id = _uid AND cj.competition_id = _competition_id
      )
    ) THEN
      RAISE EXCEPTION 'forbidden: not assigned to competition %', _competition_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF to_regclass('public.photo_verification_requests') IS NOT NULL THEN
    RETURN QUERY EXECUTE $sql$
      WITH eligible_prior AS (
        SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index
        FROM public.judge_decisions jd
        JOIN public.competition_judges cj
          ON cj.judge_id = jd.judge_id
         AND cj.competition_id = $1
        WHERE jd.round_number = $2 - 1
          AND public.is_qualifying_decision(jd.decision, $2 - 1)
        GROUP BY jd.entry_id, COALESCE(jd.photo_index, 0)
      ),
      active_verification AS (
        SELECT pvr.entry_id, COALESCE(pvr.photo_index, 0) AS photo_index
        FROM public.photo_verification_requests pvr
        WHERE pvr.competition_id = $1
          AND pvr.status IN ('pending', 'submitted')
      )
      SELECT ce.id, gs.idx
      FROM public.competition_entries ce
      CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
      WHERE ce.competition_id = $1
        AND ce.status <> 'rejected'
        AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
        AND NOT EXISTS (SELECT 1 FROM active_verification av WHERE av.entry_id = ce.id AND av.photo_index = gs.idx)
        AND (
          $2 = 1
          OR EXISTS (SELECT 1 FROM eligible_prior ep WHERE ep.entry_id = ce.id AND ep.photo_index = gs.idx)
        )
    $sql$ USING _competition_id, _round_number;
  ELSE
    RETURN QUERY
      WITH eligible_prior AS (
        SELECT jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index
        FROM public.judge_decisions jd
        JOIN public.competition_judges cj
          ON cj.judge_id = jd.judge_id
         AND cj.competition_id = _competition_id
        WHERE jd.round_number = _round_number - 1
          AND public.is_qualifying_decision(jd.decision, _round_number - 1)
        GROUP BY jd.entry_id, COALESCE(jd.photo_index, 0)
      )
      SELECT ce.id, gs.idx
      FROM public.competition_entries ce
      CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
      WHERE ce.competition_id = _competition_id
        AND ce.status <> 'rejected'
        AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
        AND (
          _round_number = 1
          OR EXISTS (SELECT 1 FROM eligible_prior ep WHERE ep.entry_id = ce.id AND ep.photo_index = gs.idx)
        );
  END IF;
END;
$function$


-- ===================== get_round_judging_gate_admin =====================
CREATE OR REPLACE FUNCTION public.get_round_judging_gate_admin(_competition_id uuid, _round_number integer)
 RETURNS TABLE(competition_id uuid, round_number integer, entry_id uuid, entry_title text, entry_status text, total_photos integer, ui_eligible_photos integer, ui_eligible_photo_indices integer[], assigned_judges integer, expected_decisions integer, present_decisions integer, missing_decisions integer, missing_decision_sample jsonb, expected_scores integer, missing_scores integer, missing_score_sample jsonb, verification_pending boolean, ready_to_lock boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
      AND e.status <> 'rejected'          -- PERMFIX: rejected entries are out of the judging surface
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
$function$


-- ===================== judging_invariants_check =====================
CREATE OR REPLACE FUNCTION public.judging_invariants_check()
 RETURNS TABLE(check_name text, status text, fail_count integer, sample jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- 1. tag_decision_drift (unchanged)
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

  -- 2. current_round_canonical (unchanged)
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

  -- 3. decision_vocabulary -- NOW CATALOG-DRIVEN (U-1)
  -- Canonical set = active v3_stage_catalog.decision_token values
  --              + small legacy alias whitelist for historical rows.
  RETURN QUERY
  WITH canonical AS (
    SELECT DISTINCT lower(decision_token) AS token
    FROM public.v3_stage_catalog
    WHERE is_active = true
    UNION
    -- Legacy aliases that historical rows may still carry (R1 era + spec V3 forgivers)
    SELECT unnest(ARRAY[
      'accepted','shortlisted','qualified','rejected',
      'needs_review','skip','finalist'
    ])
  ),
  bad AS (
    SELECT id::text, decision, round_number
    FROM public.judge_decisions
    WHERE lower(decision) NOT IN (SELECT token FROM canonical)
  )
  SELECT 'decision_vocabulary'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(b)) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM bad LIMIT 5) b;

  -- 4. eligibility_consistency (unchanged)
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
    JOIN public.competition_entries ce ON ce.id = jd.entry_id AND ce.competition_id = pc.competition_id AND ce.status <> 'rejected'
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

  -- 5. r4_stuck (unchanged — preserve original body)
  RETURN QUERY
  WITH stuck AS (
    SELECT c.id::text AS competition_id, c.title, c.status AS comp_status, c.current_round,
           jr.id::text AS round_id, jr.status AS round_status
    FROM public.competitions c
    JOIN public.judging_rounds jr ON jr.competition_id = c.id AND jr.round_number = 4
    WHERE jr.status = 'completed'
      AND c.status IN ('judging','active')
  )
  SELECT 'r4_stuck'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(s)) FILTER (WHERE s.competition_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM stuck LIMIT 5) s;

  -- 6. no_legacy_in_progression_writers (preserve)
  RETURN QUERY
  SELECT 'no_legacy_in_progression_writers'::text, 'ok'::text, 0, '[]'::jsonb;

  -- 7. rejected_entry_gate_leak (GUARDRAIL, 2026-07-20)
  --    A rejected entry must NEVER be returned by get_round_eligible_photos.
  --    This catches — the moment it happens — the class of bug where a whole
  --    entry is rejected but a judging gate still counts its shortlisted photos
  --    (which froze "Complete Round" for the judge). If this ever flips to
  --    'fail', a gate has regressed to ignoring entry-level rejection.
  RETURN QUERY
  WITH per_comp AS (
    SELECT c.id AS competition_id, r.rn AS round_number
    FROM public.competitions c
    CROSS JOIN (VALUES (2),(3),(4)) AS r(rn)
  ),
  leak AS (
    SELECT pc.competition_id, pc.round_number, ge.entry_id, ge.photo_index, ce.status
    FROM per_comp pc
    CROSS JOIN LATERAL public.get_round_eligible_photos(pc.competition_id, pc.round_number) ge
    JOIN public.competition_entries ce ON ce.id = ge.entry_id
    WHERE ce.status = 'rejected'
  )
  SELECT 'rejected_entry_gate_leak'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(l)) FILTER (WHERE l.entry_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM leak LIMIT 5) l;

END;
$function$

