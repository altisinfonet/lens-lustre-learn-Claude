CREATE OR REPLACE FUNCTION public.sync_entry_status_from_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _new_status text;
BEGIN
  -- Only sync Round 1 decisions
  IF NEW.round_number IS DISTINCT FROM 1 THEN
    RETURN NEW;
  END IF;

  -- Map decision to entry status
  CASE NEW.decision
    WHEN 'accept' THEN _new_status := 'round1_qualified';
    WHEN 'reject' THEN _new_status := 'rejected';
    WHEN 'needs_review' THEN _new_status := 'needs_review';
    WHEN 'shortlist' THEN _new_status := 'shortlisted';
    ELSE RETURN NEW;
  END CASE;

  -- Update entry status
  UPDATE public.competition_entries
  SET status = _new_status, updated_at = now()
  WHERE id = NEW.entry_id;

  RETURN NEW;
END;
$$;