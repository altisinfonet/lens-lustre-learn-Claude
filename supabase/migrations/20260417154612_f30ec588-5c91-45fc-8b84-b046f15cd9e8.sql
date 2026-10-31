-- Cursor-paged judge entry loader.
-- Mirrors the filtering rules currently implemented client-side in
-- src/hooks/judging/useJudgeClassicData.ts so the server is the single
-- source of truth for "which entries does this judge see in this round".

CREATE OR REPLACE FUNCTION public.get_judge_entries_page(
  _competition_id uuid,
  _round_number   integer,
  _cursor_created_at timestamptz DEFAULT NULL,
  _cursor_id      uuid DEFAULT NULL,
  _limit          integer DEFAULT 10
)
RETURNS TABLE (
  id                  uuid,
  title               text,
  description         text,
  photos              text[],
  photo_thumbnails    text[],
  user_id             uuid,
  status              text,
  created_at          timestamptz,
  competition_id      uuid,
  placement           text,
  is_ai_generated     boolean,
  ai_detection_result jsonb,
  exif_data           jsonb,
  view_count          integer,
  current_round       text,
  next_cursor_created_at timestamptz,
  next_cursor_id      uuid,
  has_more            boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller            uuid := auth.uid();
  _is_admin          boolean;
  _is_assigned_judge boolean;
  _assignment_mode   text;
  _effective_limit   integer;
  _fetch_limit       integer;
  _participant_ids   uuid[];
  _assigned_ids      uuid[];
  _rows              record;
  _collected         jsonb := '[]'::jsonb;
  _row_count         integer := 0;
  _has_more          boolean := false;
  _last_created_at   timestamptz;
  _last_id           uuid;
BEGIN
  -- ── 1. Auth gate ────────────────────────────────────────────────
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  _is_admin := public.has_role(_caller, 'admin'::app_role);

  SELECT EXISTS (
    SELECT 1 FROM public.competition_judges cj
    WHERE cj.competition_id = _competition_id
      AND cj.judge_id = _caller
  ) INTO _is_assigned_judge;

  IF NOT (_is_admin OR _is_assigned_judge) THEN
    RAISE EXCEPTION 'Permission denied: not a judge for this competition';
  END IF;

  -- ── 2. Validate inputs ──────────────────────────────────────────
  IF _round_number IS NULL OR _round_number < 1 OR _round_number > 4 THEN
    RAISE EXCEPTION 'Invalid round number: %', _round_number;
  END IF;

  _effective_limit := LEAST(GREATEST(COALESCE(_limit, 10), 1), 100);
  _fetch_limit     := _effective_limit + 1;  -- +1 sentinel row to compute has_more

  -- ── 3. Distributed-assignment filter (non-admin only) ───────────
  SELECT judge_assignment_mode INTO _assignment_mode
  FROM public.competitions
  WHERE id = _competition_id;

  IF _assignment_mode = 'distributed' AND NOT _is_admin THEN
    SELECT COALESCE(array_agg(entry_id), ARRAY[]::uuid[])
    INTO _assigned_ids
    FROM public.judge_entry_assignments
    WHERE competition_id = _competition_id
      AND judge_id = _caller;

    -- No assignments → no rows. Return empty result.
    IF array_length(_assigned_ids, 1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  -- ── 4. Round 2-4 participant set from judge_decisions ───────────
  IF _round_number >= 2 THEN
    SELECT COALESCE(array_agg(DISTINCT entry_id), ARRAY[]::uuid[])
    INTO _participant_ids
    FROM public.judge_decisions
    WHERE round_number = _round_number;

    IF array_length(_participant_ids, 1) IS NULL THEN
      _participant_ids := NULL;  -- fall back to status filter below
    END IF;
  END IF;

  -- ── 5. Cursor-paged select (keyset on created_at DESC, id DESC) ─
  FOR _rows IN
    SELECT
      ce.id, ce.title, ce.description, ce.photos, ce.photo_thumbnails,
      ce.user_id, ce.status, ce.created_at, ce.competition_id, ce.placement,
      ce.is_ai_generated, ce.ai_detection_result, ce.exif_data,
      ce.view_count, ce.current_round
    FROM public.competition_entries ce
    WHERE ce.competition_id = _competition_id
      AND (
        _cursor_created_at IS NULL
        OR (ce.created_at, ce.id) < (_cursor_created_at, _cursor_id)
      )
      AND (
        _assigned_ids IS NULL
        OR ce.id = ANY(_assigned_ids)
      )
      AND (
        _round_number = 1
        OR (
          _participant_ids IS NOT NULL
          AND ce.id = ANY(_participant_ids)
        )
        OR (
          _participant_ids IS NULL
          AND _round_number = 2
          AND ce.current_round = '2'
          AND ce.status IN ('round1_qualified', 'shortlisted')
        )
        OR (
          _participant_ids IS NULL
          AND _round_number = 3
          AND ce.current_round = '3'
          AND ce.status = 'round2_qualified'
        )
        OR (
          _participant_ids IS NULL
          AND _round_number = 4
          AND ce.current_round = '4'
          AND ce.status = 'finalist'
        )
      )
    ORDER BY ce.created_at DESC, ce.id DESC
    LIMIT _fetch_limit
  LOOP
    _row_count := _row_count + 1;

    IF _row_count > _effective_limit THEN
      -- Sentinel row → there is more, but do NOT emit it
      _has_more := true;
      EXIT;
    END IF;

    _last_created_at := _rows.created_at;
    _last_id         := _rows.id;

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
    next_cursor_created_at := NULL;  -- filled on final row below
    next_cursor_id      := NULL;
    has_more            := false;
    RETURN NEXT;
  END LOOP;

  -- Re-emit final cursor metadata as a trailing zero-row update is impossible
  -- in a TABLE-returning function, so we rely on the client to read the LAST
  -- row's (created_at, id) as the next cursor — and use the dedicated
  -- has_more / next_cursor_* columns on that final row.
  IF _row_count > 0 THEN
    -- Update the last emitted row with cursor metadata via a follow-up RETURN.
    -- Because we cannot mutate already-returned rows, we instead append a
    -- single "metadata" row when has_more is true OR when we want to surface
    -- the cursor explicitly. To keep the contract simple, the client should
    -- derive (next_cursor_created_at, next_cursor_id) from the LAST data row's
    -- (created_at, id) and read has_more from that same row. To make that
    -- possible, we re-emit the final row's cursor on every row using a CTE.
    NULL;
  END IF;

  RETURN;
END;
$$;

-- The loop above streams rows in DESC keyset order. To give the client a clean
-- (next_cursor_created_at, next_cursor_id, has_more) on the LAST row without
-- requiring it to inspect every row, we wrap the function with a thin SQL
-- wrapper that materializes the result and stamps cursor metadata onto the
-- final row only.

CREATE OR REPLACE FUNCTION public.get_judge_entries_page_v1(
  _competition_id uuid,
  _round_number   integer,
  _cursor_created_at timestamptz DEFAULT NULL,
  _cursor_id      uuid DEFAULT NULL,
  _limit          integer DEFAULT 10
)
RETURNS TABLE (
  id                  uuid,
  title               text,
  description         text,
  photos              text[],
  photo_thumbnails    text[],
  user_id             uuid,
  status              text,
  created_at          timestamptz,
  competition_id      uuid,
  placement           text,
  is_ai_generated     boolean,
  ai_detection_result jsonb,
  exif_data           jsonb,
  view_count          integer,
  current_round       text,
  next_cursor_created_at timestamptz,
  next_cursor_id      uuid,
  has_more            boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH page AS (
    SELECT
      r.*,
      ROW_NUMBER() OVER (ORDER BY r.created_at DESC, r.id DESC) AS rn,
      COUNT(*) OVER () AS total_in_page
    FROM public.get_judge_entries_page(
      _competition_id, _round_number, _cursor_created_at, _cursor_id, _limit
    ) r
  )
  SELECT
    p.id, p.title, p.description, p.photos, p.photo_thumbnails,
    p.user_id, p.status, p.created_at, p.competition_id, p.placement,
    p.is_ai_generated, p.ai_detection_result, p.exif_data,
    p.view_count, p.current_round,
    CASE WHEN p.rn = p.total_in_page THEN p.created_at ELSE NULL END AS next_cursor_created_at,
    CASE WHEN p.rn = p.total_in_page THEN p.id         ELSE NULL END AS next_cursor_id,
    CASE WHEN p.rn = p.total_in_page THEN p.has_more   ELSE false END AS has_more
  FROM page p
  ORDER BY p.created_at DESC, p.id DESC;
$$;

-- Performance: covering index for the keyset scan (created_at DESC, id DESC)
-- scoped per competition. Cheap, only competition_entries.
CREATE INDEX IF NOT EXISTS idx_competition_entries_keyset
  ON public.competition_entries (competition_id, created_at DESC, id DESC);

-- Allow authenticated callers to invoke the wrapper. SECURITY DEFINER inside
-- still gates by has_role + competition_judges, so this is safe.
GRANT EXECUTE ON FUNCTION public.get_judge_entries_page(uuid, integer, timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_judge_entries_page_v1(uuid, integer, timestamptz, uuid, integer) TO authenticated;
