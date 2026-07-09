-- Step 15: Server-side bulk decision application.
--
-- apply_decision_to_remaining(_competition_id, _round_number, _decision)
--
-- Applies a single decision to every (entry_id, photo_index) pair that is
-- in-scope for the given competition + round AND does NOT yet have a decision
-- recorded by the calling judge. Runs entirely server-side so the client never
-- has to ship the full entry list.
--
-- Scope rules mirror get_judge_entries_page:
--   • Round 1 → all entries in the competition.
--   • Round 2-4 → entries already advanced via judge_decisions for that round,
--                 OR entries whose status/current_round qualifies them.
--   • If competition.judge_assignment_mode = 'distributed' AND caller is NOT
--     admin, restrict to entries in judge_entry_assignments for the caller.
--
-- Photo expansion: one decision row per photo index (0..array_length(photos)-1).
--
-- Returns counts so the client can show a precise toast.

CREATE OR REPLACE FUNCTION public.apply_decision_to_remaining(
  _competition_id uuid,
  _round_number   integer,
  _decision       text
)
RETURNS TABLE (
  inserted_count   integer,
  skipped_existing integer,
  total_targeted   integer
)
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
  _participant_ids   uuid[];
  _ins               integer := 0;
  _tot               integer := 0;
BEGIN
  -- ── 1. Auth ─────────────────────────────────────────────────────
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  _is_admin := public.has_role(_caller, 'admin'::app_role);

  -- Caller must be a judge for this competition (or admin)
  SELECT EXISTS (
    SELECT 1 FROM public.competition_judges cj
    WHERE cj.competition_id = _competition_id
      AND cj.judge_id = _caller
  ) INTO _is_assigned_judge;

  IF NOT (_is_admin OR _is_assigned_judge) THEN
    RAISE EXCEPTION 'Permission denied: not a judge for this competition';
  END IF;

  -- Non-admin callers must additionally hold the judge role (mirrors RLS).
  IF NOT _is_admin AND NOT public.has_role(_caller, 'judge'::app_role) THEN
    RAISE EXCEPTION 'Permission denied: judge role required';
  END IF;

  -- ── 2. Validate inputs ──────────────────────────────────────────
  IF _round_number IS NULL OR _round_number < 1 OR _round_number > 4 THEN
    RAISE EXCEPTION 'Invalid round number: %', _round_number;
  END IF;

  IF _decision IS NULL OR NOT (_decision = ANY(_allowed_decisions)) THEN
    RAISE EXCEPTION 'Invalid decision value: %', _decision;
  END IF;

  -- ── 3. Distributed-assignment filter ────────────────────────────
  SELECT judge_assignment_mode INTO _assignment_mode
  FROM public.competitions
  WHERE id = _competition_id;

  IF _assignment_mode = 'distributed' AND NOT _is_admin THEN
    SELECT COALESCE(array_agg(entry_id), ARRAY[]::uuid[])
    INTO _assigned_ids
    FROM public.judge_entry_assignments
    WHERE competition_id = _competition_id
      AND judge_id = _caller;

    IF array_length(_assigned_ids, 1) IS NULL THEN
      -- Nothing assigned → nothing to do.
      inserted_count   := 0;
      skipped_existing := 0;
      total_targeted   := 0;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- ── 4. Round 2-4 participant set from existing decisions ────────
  IF _round_number >= 2 THEN
    SELECT COALESCE(array_agg(DISTINCT entry_id), ARRAY[]::uuid[])
    INTO _participant_ids
    FROM public.judge_decisions
    WHERE round_number = _round_number;

    IF array_length(_participant_ids, 1) IS NULL THEN
      _participant_ids := NULL;
    END IF;
  END IF;

  -- ── 5. Build target set + insert in a single CTE ────────────────
  WITH in_scope_entries AS (
    SELECT ce.id, ce.photos
    FROM public.competition_entries ce
    WHERE ce.competition_id = _competition_id
      AND (_assigned_ids IS NULL OR ce.id = ANY(_assigned_ids))
      AND (
        _round_number = 1
        OR (_participant_ids IS NOT NULL AND ce.id = ANY(_participant_ids))
        OR (_participant_ids IS NULL AND _round_number = 2
            AND ce.current_round = '2' AND ce.status IN ('round1_qualified','shortlisted'))
        OR (_participant_ids IS NULL AND _round_number = 3
            AND ce.current_round = '3' AND ce.status = 'round2_qualified')
        OR (_participant_ids IS NULL AND _round_number = 4
            AND ce.current_round = '4' AND ce.status = 'finalist')
      )
  ),
  expanded AS (
    SELECT ise.id AS entry_id,
           gs.idx  AS photo_index
    FROM in_scope_entries ise
    CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ise.photos, 1), 1) - 1, 0)) AS gs(idx)
  ),
  targets AS (
    SELECT e.entry_id, e.photo_index
    FROM expanded e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.judge_decisions jd
      WHERE jd.entry_id     = e.entry_id
        AND jd.judge_id     = _caller
        AND jd.round_number = _round_number
        AND jd.photo_index  = e.photo_index
    )
  ),
  total AS (
    SELECT COUNT(*)::integer AS n FROM expanded
  ),
  ins AS (
    INSERT INTO public.judge_decisions
      (entry_id, judge_id, round_number, decision, photo_index)
    SELECT t.entry_id, _caller, _round_number, _decision, t.photo_index
    FROM targets t
    RETURNING 1
  )
  SELECT (SELECT COUNT(*)::integer FROM ins),
         (SELECT n FROM total)
    INTO _ins, _tot;

  inserted_count   := COALESCE(_ins, 0);
  total_targeted   := COALESCE(_tot, 0);
  skipped_existing := total_targeted - inserted_count;

  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_decision_to_remaining(uuid, integer, text)
  TO authenticated;