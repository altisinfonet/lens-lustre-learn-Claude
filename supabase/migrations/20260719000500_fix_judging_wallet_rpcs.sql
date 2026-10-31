-- Phase 1 backend audit: fix 6 live, frontend-reachable RPCs that failed 100% of calls.
-- Found via plpgsql_check static analysis + runtime simulation.
-- 1) get_unjudged_parity_admin: bogus 'super_admin' app_role + judge_photo_tags (renamed judge_tag_assignments)
-- 2) wallet_ledger_v2_drift_report: bogus 'super_admin' app_role in admin gate
-- 3) get_round_judging_gate_self: OUT-param/column ambiguity + jsonb_array_length on a text[] column
-- 4) get_round_judging_gate_admin: OUT-param/column ambiguity (#variable_conflict use_column)
-- 5) get_judge_entries_page: OUT-param/column ambiguity
-- 6) get_judge_entries_page_filtered: OUT-param/column ambiguity

CREATE OR REPLACE FUNCTION public.get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer)
 RETURNS TABLE(judge_id uuid, competition_id uuid, round_number integer, eligible_count integer, tagged_count integer, sidebar_unjudged integer, grid_unjudged integer, drift integer, drift_photos jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Admin gate (mirrors other forensic RPCs)
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
    INTO v_is_admin;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    -- Round 1: every photo of every submitted entry
    SELECT ce.id AS entry_id, gs.idx AS photo_index
    FROM public.competition_entries ce
    CROSS JOIN LATERAL generate_series(0, GREATEST(array_length(ce.photos, 1), 1) - 1) AS gs(idx)
    WHERE ce.competition_id = p_competition_id
      AND ce.status = 'submitted'
      AND p_round_number = 1

    UNION ALL

    -- Round 2+: photos that ANY judge tagged as shortlist/qualified in prior round
    SELECT jpt.entry_id, jpt.photo_index
    FROM public.judge_tag_assignments jpt
    JOIN public.judging_tags t ON t.id = jpt.tag_id
    JOIN public.competition_entries ce ON ce.id = jpt.entry_id
    WHERE ce.competition_id = p_competition_id
      AND p_round_number > 1
      AND jpt.round_number = p_round_number - 1
      AND COALESCE(t.label, '') ILIKE ANY (ARRAY['%shortlist%', '%qualified%'])
    GROUP BY jpt.entry_id, jpt.photo_index
  ),
  eligible_dedup AS (
    SELECT DISTINCT entry_id, photo_index FROM eligible
  ),
  tagged AS (
    SELECT DISTINCT jpt.entry_id, jpt.photo_index
    FROM public.judge_tag_assignments jpt
    JOIN public.competition_entries ce ON ce.id = jpt.entry_id
    WHERE ce.competition_id = p_competition_id
      AND jpt.judge_id = p_judge_id
      AND jpt.round_number = p_round_number
  ),
  unjudged AS (
    SELECT e.entry_id, e.photo_index
    FROM eligible_dedup e
    LEFT JOIN tagged tg
      ON tg.entry_id = e.entry_id AND tg.photo_index = e.photo_index
    WHERE tg.entry_id IS NULL
  ),
  totals AS (
    SELECT
      (SELECT count(*)::int FROM eligible_dedup)               AS eligible_count,
      (SELECT count(*)::int FROM tagged
        WHERE (entry_id, photo_index) IN
              (SELECT entry_id, photo_index FROM eligible_dedup)) AS tagged_count,
      (SELECT count(*)::int FROM unjudged)                     AS unjudged_count
  )
  SELECT
    p_judge_id,
    p_competition_id,
    p_round_number,
    t.eligible_count,
    t.tagged_count,
    (t.eligible_count - t.tagged_count)::int  AS sidebar_unjudged,
    t.unjudged_count                          AS grid_unjudged,
    ((t.eligible_count - t.tagged_count) - t.unjudged_count)::int AS drift,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'entry_id', u.entry_id,
        'photo_index', u.photo_index
      ) ORDER BY u.entry_id, u.photo_index)
       FROM unjudged u),
      '[]'::jsonb
    ) AS drift_photos
  FROM totals t;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.wallet_ledger_v2_drift_report(p_window interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
  v_since timestamptz := now() - p_window;
  v_audit_total bigint;
  v_audit_dry_ok bigint;
  v_audit_replay bigint;
  v_audit_error bigint;
  v_audit_live_ok bigint;
  v_shadow_total bigint;
  v_shadow_valid bigint;
  v_shadow_invalid bigint;
  v_idem_total bigint;
  v_error_breakdown jsonb;
BEGIN
  -- Admin-only gate (no anon/authenticated leakage)
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE result = 'dry_run_ok'),
         count(*) FILTER (WHERE result = 'replay'),
         count(*) FILTER (WHERE result = 'error'),
         count(*) FILTER (WHERE result = 'live_ok')
  INTO v_audit_total, v_audit_dry_ok, v_audit_replay, v_audit_error, v_audit_live_ok
  FROM public.wallet_ledger_audit_log
  WHERE captured_at >= v_since;

  SELECT count(*),
         count(*) FILTER (WHERE validation_ok = true),
         count(*) FILTER (WHERE validation_ok = false)
  INTO v_shadow_total, v_shadow_valid, v_shadow_invalid
  FROM public.wallet_ledger_shadow_log
  WHERE captured_at >= v_since;

  SELECT count(*) INTO v_idem_total
  FROM public.wallet_ledger_idempotency
  WHERE created_at >= v_since;

  SELECT COALESCE(jsonb_object_agg(error_code, c), '{}'::jsonb)
  INTO v_error_breakdown
  FROM (
    SELECT error_code, count(*) AS c
    FROM public.wallet_ledger_audit_log
    WHERE captured_at >= v_since AND result = 'error' AND error_code IS NOT NULL
    GROUP BY error_code
  ) e;

  RETURN jsonb_build_object(
    'window_start', v_since,
    'window_end',   now(),
    'audit', jsonb_build_object(
      'total',       v_audit_total,
      'dry_run_ok',  v_audit_dry_ok,
      'replay',      v_audit_replay,
      'error',       v_audit_error,
      'live_ok',     v_audit_live_ok
    ),
    'shadow', jsonb_build_object(
      'total',   v_shadow_total,
      'valid',   v_shadow_valid,
      'invalid', v_shadow_invalid
    ),
    'idempotency', jsonb_build_object(
      'rows_in_window', v_idem_total
    ),
    'error_breakdown', v_error_breakdown,
    'note', 'read-only; no wallet mutation; A1.6 scope'
  );
END;
$function$
;

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
;

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
;

CREATE OR REPLACE FUNCTION public.get_judge_entries_page(_competition_id uuid, _round_number integer, _cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _cursor_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, title text, description text, photos text[], photo_thumbnails text[], user_id uuid, status text, created_at timestamp with time zone, competition_id uuid, placement text, is_ai_generated boolean, ai_detection_result jsonb, exif_data jsonb, view_count integer, current_round text, next_cursor_created_at timestamp with time zone, next_cursor_id uuid, has_more boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _caller            uuid := auth.uid();
  _is_admin          boolean;
  _is_assigned_judge boolean;
  _assignment_mode   text;
  _effective_limit   integer;
  _fetch_limit       integer;
  _assigned_ids      uuid[];
  _eligible_ids      uuid[];
  _rows              record;
  _row_count         integer := 0;
  _has_more          boolean := false;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  _is_admin := public.has_role(_caller, 'admin'::app_role);

  SELECT EXISTS (
    SELECT 1 FROM public.competition_judges cj
    WHERE cj.competition_id = _competition_id AND cj.judge_id = _caller
  ) INTO _is_assigned_judge;

  IF NOT (_is_admin OR _is_assigned_judge) THEN
    RAISE EXCEPTION 'Permission denied: not a judge for this competition';
  END IF;

  IF _round_number IS NULL OR _round_number < 1 OR _round_number > 4 THEN
    RAISE EXCEPTION 'Invalid round number: %', _round_number;
  END IF;

  _effective_limit := LEAST(GREATEST(COALESCE(_limit, 10), 1), 100);
  _fetch_limit     := _effective_limit + 1;

  SELECT judge_assignment_mode INTO _assignment_mode
  FROM public.competitions WHERE id = _competition_id;

  IF _assignment_mode = 'distributed' AND NOT _is_admin THEN
    SELECT COALESCE(array_agg(entry_id), ARRAY[]::uuid[])
    INTO _assigned_ids
    FROM public.judge_entry_assignments
    WHERE competition_id = _competition_id AND judge_id = _caller;

    IF array_length(_assigned_ids, 1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  IF _round_number >= 2 THEN
    -- Only count shortlists from currently-assigned judges.
    SELECT COALESCE(array_agg(DISTINCT jd.entry_id), ARRAY[]::uuid[])
    INTO _eligible_ids
    FROM public.judge_decisions jd
    JOIN public.competition_entries ce ON ce.id = jd.entry_id
    JOIN public.competition_judges cj
      ON cj.judge_id = jd.judge_id
     AND cj.competition_id = _competition_id
    WHERE ce.competition_id = _competition_id
      AND jd.round_number   = _round_number - 1
      AND jd.decision IN ('shortlist','shortlisted');

    IF array_length(_eligible_ids, 1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  FOR _rows IN
    SELECT
      ce.id, ce.title, ce.description, ce.photos, ce.photo_thumbnails,
      ce.user_id, ce.status, ce.created_at, ce.competition_id, ce.placement,
      ce.is_ai_generated, ce.ai_detection_result, ce.exif_data,
      ce.view_count, ce.current_round
    FROM public.competition_entries ce
    WHERE ce.competition_id = _competition_id
      AND (_cursor_created_at IS NULL OR (ce.created_at, ce.id) < (_cursor_created_at, _cursor_id))
      AND (_assigned_ids IS NULL OR ce.id = ANY(_assigned_ids))
      AND (
        _round_number = 1
        OR (_eligible_ids IS NOT NULL AND ce.id = ANY(_eligible_ids))
      )
    ORDER BY ce.created_at DESC, ce.id DESC
    LIMIT _fetch_limit
  LOOP
    _row_count := _row_count + 1;
    IF _row_count > _effective_limit THEN
      _has_more := true;
      EXIT;
    END IF;

    id                  := _rows.id;
    title               := _rows.title;
    description         := _rows.description;
    photos              := _rows.photos;
    photo_thumbnails    := _rows.photo_thumbnails;
    user_id             := _rows.user_id;
    status              := _rows.status;
    created_at          := _rows.created_at;
    competition_id      := _rows.competition_id;
    placement           := _rows.placement;
    is_ai_generated     := _rows.is_ai_generated;
    ai_detection_result := _rows.ai_detection_result;
    exif_data           := _rows.exif_data;
    view_count          := _rows.view_count;
    current_round       := _rows.current_round;
    next_cursor_created_at := NULL;
    next_cursor_id      := NULL;
    has_more            := false;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text DEFAULT NULL::text, _cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _cursor_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, title text, description text, photos text[], photo_thumbnails text[], user_id uuid, status text, created_at timestamp with time zone, competition_id uuid, placement text, is_ai_generated boolean, ai_detection_result jsonb, exif_data jsonb, view_count integer, current_round text, bucket text, matching_photo_indexes integer[], next_cursor_created_at timestamp with time zone, next_cursor_id uuid, has_more boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _caller            uuid := auth.uid();
  _is_admin          boolean;
  _is_assigned_judge boolean;
  _assignment_mode   text;
  _effective_limit   integer;
  _fetch_limit       integer;
  _assigned_ids      uuid[];
  _eligible_ids      uuid[];
  _candidate_ids     uuid[];
  _bucket_norm       text;
  _allowed_buckets   text[];
  _rows              record;
  _row_count         integer := 0;
  _has_more          boolean := false;
BEGIN
  -- ── 1. Auth ─────────────────────────────────────────────────────────────
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  _is_admin := public.has_role(_caller, 'admin'::app_role);

  SELECT EXISTS (
    SELECT 1 FROM public.competition_judges cj
    WHERE cj.competition_id = _competition_id AND cj.judge_id = _caller
  ) INTO _is_assigned_judge;

  IF NOT (_is_admin OR _is_assigned_judge) THEN
    RAISE EXCEPTION 'Permission denied: not a judge for this competition';
  END IF;

  -- ── 2. Round validation ────────────────────────────────────────────────
  IF _round_number IS NULL OR _round_number < 1 OR _round_number > 4 THEN
    RAISE EXCEPTION 'Invalid round number: %', _round_number;
  END IF;

  _effective_limit := LEAST(GREATEST(COALESCE(_limit, 10), 1), 100);
  _fetch_limit     := _effective_limit + 1;

  -- ── 3. Bucket validation (Master Key v2 §5: retired keys are forbidden)
  _bucket_norm := NULLIF(TRIM(LOWER(_bucket)), '');

  IF _bucket_norm IN ('not_selected_r3', 'not_selected_final',
                      'r2_not_selected', 'r3_not_selected') THEN
    RAISE EXCEPTION
      'Bucket % is a retired derived label, not a queryable stored bucket. '
      'See Master Key v2 §5.', _bucket_norm;
  END IF;

  IF _bucket_norm IS NOT NULL THEN
    _allowed_buckets := CASE _round_number
      WHEN 1 THEN ARRAY['accept','accepted','shortlist','shortlisted','needs_review','reject','rejected']
      WHEN 2 THEN ARRAY['accept','accepted','shortlist','shortlisted','qualified_r3']
      WHEN 3 THEN ARRAY['accept','accepted','shortlist','shortlisted','qualified_final','shortlisted_final']
      WHEN 4 THEN ARRAY[]::text[]   -- R4 uses tags, no bucket filter
    END;

    IF NOT (_bucket_norm = ANY(_allowed_buckets)) THEN
      RAISE EXCEPTION
        'Bucket % is not valid for round %. Allowed: %',
        _bucket_norm, _round_number, _allowed_buckets;
    END IF;
  END IF;

  -- ── 4. Distributed-mode assignment scope ──────────────────────────────
  SELECT judge_assignment_mode INTO _assignment_mode
  FROM public.competitions WHERE id = _competition_id;

  IF _assignment_mode = 'distributed' AND NOT _is_admin THEN
    SELECT COALESCE(array_agg(entry_id), ARRAY[]::uuid[])
    INTO _assigned_ids
    FROM public.judge_entry_assignments
    WHERE competition_id = _competition_id AND judge_id = _caller;

    IF array_length(_assigned_ids, 1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  -- ── 5. Round eligibility (mirror existing get_judge_entries_page) ─────
  IF _round_number >= 2 THEN
    SELECT COALESCE(array_agg(DISTINCT jd.entry_id), ARRAY[]::uuid[])
    INTO _eligible_ids
    FROM public.judge_decisions jd
    JOIN public.competition_entries ce ON ce.id = jd.entry_id
    JOIN public.competition_judges cj
      ON cj.judge_id = jd.judge_id
     AND cj.competition_id = _competition_id
    WHERE ce.competition_id = _competition_id
      AND jd.round_number   = _round_number - 1
      AND jd.decision IN ('shortlist','shortlisted');

    IF array_length(_eligible_ids, 1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  -- ── 6. Bucket filter via per-photo CONSENSUS (aggregate, not per-judge) ─
  IF _bucket_norm IS NOT NULL THEN
    -- Candidate set = entries in this competition+round that pass scope/eligibility
    WITH scope_entries AS (
      SELECT ce.id
      FROM public.competition_entries ce
      WHERE ce.competition_id = _competition_id
        AND (_assigned_ids IS NULL OR ce.id = ANY(_assigned_ids))
        AND (_round_number = 1 OR ce.id = ANY(_eligible_ids))
    ),
    consensus AS (
      SELECT *
      FROM public.get_per_photo_consensus(
        ARRAY(SELECT id FROM scope_entries)
      )
      WHERE round_number = _round_number
    )
    SELECT COALESCE(array_agg(DISTINCT entry_id), ARRAY[]::uuid[])
    INTO _candidate_ids
    FROM consensus
    WHERE has_consensus = true
      AND (
        decision = _bucket_norm
        OR (_bucket_norm IN ('accept','accepted')              AND decision IN ('accept','accepted'))
        OR (_bucket_norm IN ('shortlist','shortlisted','qualified_r3','qualified_final','shortlisted_final')
            AND decision IN ('shortlist','shortlisted','qualified_r3','qualified_final','shortlisted_final'))
        OR (_bucket_norm IN ('reject','rejected')              AND decision IN ('reject','rejected'))
        OR (_bucket_norm = 'needs_review'                       AND decision = 'needs_review')
      );

    IF _candidate_ids IS NULL OR array_length(_candidate_ids, 1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  -- ── 7. Page rows + per-row matching photo_indexes ─────────────────────
  FOR _rows IN
    SELECT
      ce.id, ce.title, ce.description, ce.photos, ce.photo_thumbnails,
      ce.user_id, ce.status, ce.created_at, ce.competition_id, ce.placement,
      ce.is_ai_generated, ce.ai_detection_result, ce.exif_data,
      ce.view_count, ce.current_round
    FROM public.competition_entries ce
    WHERE ce.competition_id = _competition_id
      AND (_cursor_created_at IS NULL OR (ce.created_at, ce.id) < (_cursor_created_at, _cursor_id))
      AND (_assigned_ids IS NULL OR ce.id = ANY(_assigned_ids))
      AND (_round_number = 1 OR ce.id = ANY(_eligible_ids))
      AND (_bucket_norm IS NULL OR ce.id = ANY(_candidate_ids))
    ORDER BY ce.created_at DESC, ce.id DESC
    LIMIT _fetch_limit
  LOOP
    _row_count := _row_count + 1;
    IF _row_count > _effective_limit THEN
      _has_more := true;
      EXIT;
    END IF;

    id                  := _rows.id;
    title               := _rows.title;
    description         := _rows.description;
    photos              := _rows.photos;
    photo_thumbnails    := _rows.photo_thumbnails;
    user_id             := _rows.user_id;
    status              := _rows.status;
    created_at          := _rows.created_at;
    competition_id      := _rows.competition_id;
    placement           := _rows.placement;
    is_ai_generated     := _rows.is_ai_generated;
    ai_detection_result := _rows.ai_detection_result;
    exif_data           := _rows.exif_data;
    view_count          := _rows.view_count;
    current_round       := _rows.current_round;
    bucket              := _bucket_norm;

    -- Which photos in this entry actually match the bucket (consensus grain)
    IF _bucket_norm IS NULL THEN
      matching_photo_indexes := NULL;
    ELSE
      SELECT COALESCE(array_agg(c.photo_index ORDER BY c.photo_index), ARRAY[]::integer[])
      INTO matching_photo_indexes
      FROM public.get_per_photo_consensus(ARRAY[_rows.id]) c
      WHERE c.round_number = _round_number
        AND c.has_consensus = true
        AND (
          c.decision = _bucket_norm
          OR (_bucket_norm IN ('accept','accepted')         AND c.decision IN ('accept','accepted'))
          OR (_bucket_norm IN ('shortlist','shortlisted','qualified_r3','qualified_final','shortlisted_final')
              AND c.decision IN ('shortlist','shortlisted','qualified_r3','qualified_final','shortlisted_final'))
          OR (_bucket_norm IN ('reject','rejected')         AND c.decision IN ('reject','rejected'))
          OR (_bucket_norm = 'needs_review'                  AND c.decision = 'needs_review')
        );
    END IF;

    next_cursor_created_at := NULL;
    next_cursor_id      := NULL;
    has_more            := false;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$
;

