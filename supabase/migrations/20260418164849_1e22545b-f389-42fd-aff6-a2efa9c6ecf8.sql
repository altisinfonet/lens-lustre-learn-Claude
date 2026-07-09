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
BEGIN
  -- Source of truth = the decision's own round_number (per-photo model).
  -- Previously this read entry.current_round, which is now cosmetic/stale
  -- after the per-photo migration and incorrectly blocked R2+ scoring.
  _round_number := COALESCE(NEW.round_number, OLD.round_number);

  SELECT competition_id INTO _comp_id
  FROM public.competition_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

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