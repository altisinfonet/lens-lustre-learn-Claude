-- =====================================================================
-- PHASE 4 — Align progression_decision with v3_stage_catalog (16 keys)
-- =====================================================================
-- Strategy: replace legacy CHECK (8 hardcoded tokens) with a validation
-- TRIGGER that dynamically references v3_stage_catalog (is_active = true).
-- This honors:
--   - Mandate "Use Validation Triggers Instead of Check Constraints"
--   - Rule 3: no hardcoded 16 keys
--   - Rule 4: any_photo_pending(), gated RPC, and pending-gate trigger
--             remain UNTOUCHED
-- =====================================================================

-- 1. Drop legacy hardcoded CHECK constraint
ALTER TABLE public.competition_entries
  DROP CONSTRAINT IF EXISTS progression_decision_valid;

-- 2. Validation trigger function — dynamic vocabulary lookup
CREATE OR REPLACE FUNCTION public.enforce_progression_decision_vocabulary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NULL is always allowed (cleared / not-yet-decided)
  IF NEW.progression_decision IS NULL THEN
    RETURN NEW;
  END IF;

  -- No-op update: skip
  IF TG_OP = 'UPDATE'
     AND OLD.progression_decision IS NOT DISTINCT FROM NEW.progression_decision THEN
    RETURN NEW;
  END IF;

  -- Dynamic vocabulary check against v3_stage_catalog
  IF NOT EXISTS (
    SELECT 1
    FROM public.v3_stage_catalog
    WHERE is_active = true
      AND stage_key = NEW.progression_decision
  ) THEN
    RAISE EXCEPTION
      'progression_decision % is not a valid v3_stage_catalog stage_key (entry %)',
      NEW.progression_decision, NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Attach trigger — fires BEFORE the existing pending-gate trigger?
--    Order: Postgres fires BEFORE triggers alphabetically. We want the
--    pending-gate (trg_progression_decision_pending_gate) to ALSO run.
--    Both will fire; either failing aborts. Naming with 'a_' prefix would
--    force this one first, but order is irrelevant since BOTH must pass.
CREATE TRIGGER trg_progression_decision_vocabulary_gate
  BEFORE INSERT OR UPDATE OF progression_decision
  ON public.competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_progression_decision_vocabulary();

COMMENT ON FUNCTION public.enforce_progression_decision_vocabulary() IS
  'Phase 4: enforces progression_decision ∈ v3_stage_catalog (is_active=true). Dynamic — no hardcoded vocabulary. Replaces legacy CHECK constraint progression_decision_valid.';

COMMENT ON TRIGGER trg_progression_decision_vocabulary_gate ON public.competition_entries IS
  'Phase 4: vocabulary validation. Runs alongside trg_progression_decision_pending_gate (Phase 3). Both must pass.';
