-- Spec v3 Golden Rule #3: Non-system judging tags must live in Round 4 only.
-- System tags (decision/verification semantics) are exempt because they legitimately
-- belong to R1/R2/R3 (e.g. "Accepted" in R1, "Verification Required - Round 2" in R2).

-- 1. Backfill any stray non-system tag to Round 4 (idempotent — no rows currently affected per audit).
UPDATE public.judging_tags
   SET visible_in_round = ARRAY[4]
 WHERE COALESCE(is_system, false) = false
   AND (visible_in_round IS DISTINCT FROM ARRAY[4]);

-- 2. Validation trigger (we use a trigger, not a CHECK constraint, per project policy).
CREATE OR REPLACE FUNCTION public.enforce_non_system_tags_round4()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_system, false) = false THEN
    IF NEW.visible_in_round IS NULL
       OR array_length(NEW.visible_in_round, 1) IS DISTINCT FROM 1
       OR NEW.visible_in_round[1] <> 4 THEN
      RAISE EXCEPTION 'Non-system judging tags must have visible_in_round = ARRAY[4] (Spec v3 Golden Rule #3). Got: %', NEW.visible_in_round
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_non_system_tags_round4 ON public.judging_tags;
CREATE TRIGGER trg_enforce_non_system_tags_round4
  BEFORE INSERT OR UPDATE OF visible_in_round, is_system
  ON public.judging_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_non_system_tags_round4();