
-- Fix orphan-judge decision leakage across all eligibility/coverage RPCs.
-- Only count judge_decisions made by judges CURRENTLY assigned to the competition.

CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(_competition_id uuid, _round_number integer)
 RETURNS TABLE(entry_id uuid, photo_index integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ce.id AS entry_id, gs.idx AS photo_index
  FROM public.competition_entries ce
  CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos,1),1)-1, 0)) AS gs(idx)
  WHERE ce.competition_id = _competition_id
    AND (
      _round_number = 1
      OR EXISTS (
        SELECT 1
        FROM public.judge_decisions jd
        JOIN public.competition_judges cj
          ON cj.judge_id = jd.judge_id
         AND cj.competition_id = _competition_id
        WHERE jd.entry_id     = ce.id
          AND jd.photo_index  = gs.idx
          AND jd.round_number = _round_number - 1
          AND jd.decision IN ('shortlist','shortlisted')
      )
    );
$function$;

-- Also fix the entries-page RPC so the judge UI never lists entries
-- promoted only by orphan judges.
CREATE OR REPLACE FUNCTION public.get_judge_entries_page(
  _competition_id uuid,
  _round_number integer,
  _cursor_created_at timestamp with time zone DEFAULT NULL,
  _cursor_id uuid DEFAULT NULL,
  _limit integer DEFAULT 10
)
 RETURNS TABLE(id uuid, title text, description text, photos text[], photo_thumbnails text[], user_id uuid, status text, created_at timestamp with time zone, competition_id uuid, placement text, is_ai_generated boolean, ai_detection_result jsonb, exif_data jsonb, view_count integer, current_round text, next_cursor_created_at timestamp with time zone, next_cursor_id uuid, has_more boolean)
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
$function$;

-- Also fix bulk-decision RPC: targets must be derived from assigned-judge shortlists only.
CREATE OR REPLACE FUNCTION public.apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text)
 RETURNS TABLE(inserted_count integer, skipped_existing integer, total_targeted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller            uuid := auth.uid();
  _is_admin          boolean;
  _is_assigned_judge boolean;
  _assignment_mode   text;
  _allowed_decisions text[] := ARRAY[
    'accept','accepted','approved','round1_qualified',
    'reject','rejected',
    'shortlist','shortlisted',
    'needs_review',
    'finalist','winner','runner_up','third_place','honorable_mention'
  ];
  _assigned_ids      uuid[];
  _ins               integer := 0;
  _tot               integer := 0;
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

  IF NOT _is_admin AND NOT public.has_role(_caller, 'judge'::app_role) THEN
    RAISE EXCEPTION 'Permission denied: judge role required';
  END IF;

  IF _round_number IS NULL OR _round_number < 1 OR _round_number > 4 THEN
    RAISE EXCEPTION 'Invalid round number: %', _round_number;
  END IF;

  IF _decision IS NULL OR NOT (_decision = ANY(_allowed_decisions)) THEN
    RAISE EXCEPTION 'Invalid decision value: %', _decision;
  END IF;

  SELECT judge_assignment_mode INTO _assignment_mode
  FROM public.competitions WHERE id = _competition_id;

  IF _assignment_mode = 'distributed' AND NOT _is_admin THEN
    SELECT COALESCE(array_agg(entry_id), ARRAY[]::uuid[])
    INTO _assigned_ids
    FROM public.judge_entry_assignments
    WHERE competition_id = _competition_id AND judge_id = _caller;

    IF array_length(_assigned_ids, 1) IS NULL THEN
      inserted_count := 0; skipped_existing := 0; total_targeted := 0;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  WITH eligible_pairs AS (
    SELECT ce.id AS entry_id, gs.idx AS photo_index
    FROM public.competition_entries ce
    CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos, 1), 1) - 1, 0)) AS gs(idx)
    WHERE ce.competition_id = _competition_id
      AND (_assigned_ids IS NULL OR ce.id = ANY(_assigned_ids))
      AND (
        _round_number = 1
        OR EXISTS (
          SELECT 1
          FROM public.judge_decisions jd
          JOIN public.competition_judges cj
            ON cj.judge_id = jd.judge_id
           AND cj.competition_id = _competition_id
          WHERE jd.entry_id     = ce.id
            AND jd.photo_index  = gs.idx
            AND jd.round_number = _round_number - 1
            AND jd.decision IN ('shortlist','shortlisted')
        )
      )
  ),
  targets AS (
    SELECT ep.entry_id, ep.photo_index
    FROM eligible_pairs ep
    WHERE NOT EXISTS (
      SELECT 1 FROM public.judge_decisions jd
      WHERE jd.entry_id     = ep.entry_id
        AND jd.judge_id     = _caller
        AND jd.round_number = _round_number
        AND jd.photo_index  = ep.photo_index
    )
  ),
  total AS (SELECT COUNT(*)::integer AS n FROM eligible_pairs),
  ins AS (
    INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, decision, photo_index)
    SELECT t.entry_id, _caller, _round_number, _decision, t.photo_index
    FROM targets t
    RETURNING 1
  )
  SELECT (SELECT COUNT(*)::integer FROM ins), (SELECT n FROM total)
    INTO _ins, _tot;

  inserted_count   := COALESCE(_ins, 0);
  total_targeted   := COALESCE(_tot, 0);
  skipped_existing := total_targeted - inserted_count;
  RETURN NEXT;
END;
$function$;
