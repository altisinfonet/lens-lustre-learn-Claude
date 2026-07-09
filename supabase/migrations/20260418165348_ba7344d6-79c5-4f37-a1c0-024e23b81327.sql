CREATE OR REPLACE FUNCTION public.enforce_round_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _comp_id uuid;
  _round_status text;
  _round_number int;
  _entry_id uuid;
  _row jsonb;
BEGIN
  -- Use jsonb so we can read optional columns (round_number / round_id) without
  -- failing on tables that don't have them.
  IF TG_OP = 'DELETE' THEN
    _row := to_jsonb(OLD);
  ELSE
    _row := to_jsonb(NEW);
  END IF;

  _entry_id := NULLIF(_row->>'entry_id','')::uuid;
  IF _entry_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- 1) Prefer explicit round_number on the row (judge_decisions)
  IF _row ? 'round_number' AND _row->>'round_number' IS NOT NULL THEN
    _round_number := (_row->>'round_number')::int;
  END IF;

  -- 2) Else resolve via round_id (judge_comments)
  IF _round_number IS NULL AND _row ? 'round_id' AND NULLIF(_row->>'round_id','') IS NOT NULL THEN
    SELECT round_number INTO _round_number
    FROM public.judging_rounds
    WHERE id = (_row->>'round_id')::uuid;
  END IF;

  -- 3) Else fall back to entry.current_round (judge_scores, judge_tag_assignments)
  IF _round_number IS NULL THEN
    SELECT NULLIF(current_round,'')::int, competition_id
      INTO _round_number, _comp_id
    FROM public.competition_entries WHERE id = _entry_id;
  ELSE
    SELECT competition_id INTO _comp_id
    FROM public.competition_entries WHERE id = _entry_id;
  END IF;

  IF _round_number IS NOT NULL AND _comp_id IS NOT NULL THEN
    SELECT status INTO _round_status
    FROM public.judging_rounds
    WHERE competition_id = _comp_id
      AND round_number = _round_number;

    IF _round_status = 'completed' THEN
      RAISE EXCEPTION 'This round has been completed. Scoring is locked.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;