
CREATE OR REPLACE FUNCTION public.enforce_progression_decision_pending_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only evaluate when a non-NULL progression_decision is being set.
  IF NEW.progression_decision IS NULL THEN
    RETURN NEW;
  END IF;

  -- For UPDATEs: skip if the value didn't actually change (no-op writes pass).
  IF TG_OP = 'UPDATE'
     AND NEW.progression_decision IS NOT DISTINCT FROM OLD.progression_decision THEN
    RETURN NEW;
  END IF;

  -- Pending gate: reject write if any photo in current_round lacks a valid decision.
  IF public.any_photo_pending(NEW.id) THEN
    RAISE EXCEPTION
      'progression_decision cannot be set to % while entry % has pending photos in current_round (any_photo_pending = TRUE). Phase 3 Step 4 gate.',
      NEW.progression_decision, NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_progression_decision_pending_gate ON public.competition_entries;

CREATE TRIGGER trg_progression_decision_pending_gate
BEFORE INSERT OR UPDATE OF progression_decision
ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.enforce_progression_decision_pending_gate();

COMMENT ON FUNCTION public.enforce_progression_decision_pending_gate() IS
'Phase 3 · Step 4. Blocks INSERT/UPDATE that sets competition_entries.progression_decision to a non-NULL value while any_photo_pending(id)=TRUE. NULL writes and no-op writes always pass. No fallback.';
