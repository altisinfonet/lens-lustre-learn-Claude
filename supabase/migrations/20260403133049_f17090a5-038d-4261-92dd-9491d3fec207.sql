-- L4/L5: Score range validation trigger (0–10)
CREATE OR REPLACE FUNCTION public.validate_judge_score_range()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.score < 0 OR NEW.score > 10 THEN
    RAISE EXCEPTION 'Score must be between 0 and 10, got %', NEW.score;
  END IF;
  IF NEW.composition_score IS NOT NULL AND (NEW.composition_score < 0 OR NEW.composition_score > 10) THEN
    RAISE EXCEPTION 'Composition score must be between 0 and 10';
  END IF;
  IF NEW.color_palette_score IS NOT NULL AND (NEW.color_palette_score < 0 OR NEW.color_palette_score > 10) THEN
    RAISE EXCEPTION 'Color palette score must be between 0 and 10';
  END IF;
  IF NEW.technique_score IS NOT NULL AND (NEW.technique_score < 0 OR NEW.technique_score > 10) THEN
    RAISE EXCEPTION 'Technique score must be between 0 and 10';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_judge_score_range ON public.judge_scores;
CREATE TRIGGER trg_validate_judge_score_range
  BEFORE INSERT OR UPDATE ON public.judge_scores
  FOR EACH ROW EXECUTE FUNCTION public.validate_judge_score_range();

-- L7: Round-locking trigger — reject writes when round is completed
CREATE OR REPLACE FUNCTION public.enforce_round_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _entry_round text;
  _round_status text;
BEGIN
  -- Get the entry's current_round
  SELECT current_round INTO _entry_round
  FROM public.competition_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

  IF _entry_round IS NOT NULL THEN
    SELECT status INTO _round_status
    FROM public.judging_rounds
    WHERE id = _entry_round::uuid;

    IF _round_status = 'completed' THEN
      -- Admins can bypass the lock
      IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
        RAISE EXCEPTION 'This round has been completed. Scoring is locked.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Apply round-lock to all three judge tables
DROP TRIGGER IF EXISTS trg_enforce_round_lock ON public.judge_scores;
CREATE TRIGGER trg_enforce_round_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.judge_scores
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_lock();

DROP TRIGGER IF EXISTS trg_enforce_round_lock ON public.judge_tag_assignments;
CREATE TRIGGER trg_enforce_round_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.judge_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_lock();

DROP TRIGGER IF EXISTS trg_enforce_round_lock ON public.judge_comments;
CREATE TRIGGER trg_enforce_round_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.judge_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_lock();