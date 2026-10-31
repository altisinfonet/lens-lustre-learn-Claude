-- ============================================================================
-- get_judge_entries_page_filtered: bucket-aware paginated entries for /judge
-- Master Key v2 §2 + §5 compliant: only stored decision tokens are valid
-- buckets. r2_not_selected / r3_not_selected are derived (forbidden as bucket).
-- Scope: aggregate per-photo consensus (get_per_photo_consensus) — all judges
-- and admins see the same list per bucket.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_judge_entries_page_filtered(
  _competition_id        uuid,
  _round_number          integer,
  _bucket                text DEFAULT NULL,
  _cursor_created_at     timestamp with time zone DEFAULT NULL,
  _cursor_id             uuid DEFAULT NULL,
  _limit                 integer DEFAULT 10
)
RETURNS TABLE (
  id                       uuid,
  title                    text,
  description              text,
  photos                   text[],
  photo_thumbnails         text[],
  user_id                  uuid,
  status                   text,
  created_at               timestamp with time zone,
  competition_id           uuid,
  placement                text,
  is_ai_generated          boolean,
  ai_detection_result      jsonb,
  exif_data                jsonb,
  view_count               integer,
  current_round            text,
  bucket                   text,
  matching_photo_indexes   integer[],
  next_cursor_created_at   timestamp with time zone,
  next_cursor_id           uuid,
  has_more                 boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.get_judge_entries_page_filtered(uuid,integer,text,timestamp with time zone,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_judge_entries_page_filtered(uuid,integer,text,timestamp with time zone,uuid,integer) TO authenticated;