-- C-2: Auto-tier scoring trigger
-- Derives judge_decisions.decision from average of 10 SOW criteria on judge_scores upsert.
-- Round derived from competitions.current_round (set by complete-round edge function).
-- R1 is decision-only (no scoring) → trigger no-ops for round 1.

CREATE OR REPLACE FUNCTION public.derive_decision_from_score(
  _avg numeric,
  _round_number integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  -- Null/zero average → Needs Review (judge has not committed any score)
  IF _avg IS NULL OR _avg = 0 THEN
    RETURN 'needs_review';
  END IF;

  -- Round-specific tiering per SOW
  IF _round_number = 2 THEN
    -- 1-6 → Qualified for R2; 7-10 → Shortlisted for R3
    IF _avg >= 7 THEN RETURN 'shortlist'; ELSE RETURN 'qualified'; END IF;

  ELSIF _round_number = 3 THEN
    -- 1-6 → Qualified for R3; 7-10 → Shortlisted for Final
    IF _avg >= 7 THEN RETURN 'shortlist'; ELSE RETURN 'qualified'; END IF;

  ELSIF _round_number = 4 THEN
    -- 1-6 → Qualified for Final; 7-10 → Award-eligible (Finalist; admin assigns Winner/RU placement)
    IF _avg >= 7 THEN RETURN 'finalist'; ELSE RETURN 'qualified'; END IF;
  END IF;

  -- R1 or unknown → no auto-decision (R1 is purely manual decision mode)
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_tier_judge_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _round_text text;
  _round_number integer;
  _criteria_values numeric[];
  _criteria_count integer;
  _criteria_sum numeric;
  _avg numeric;
  _decision text;
BEGIN
  -- Resolve round from the competition this entry belongs to
  SELECT c.current_round
    INTO _round_text
  FROM public.competition_entries ce
  JOIN public.competitions c ON c.id = ce.competition_id
  WHERE ce.id = NEW.entry_id;

  -- Parse round number; bail if unset, R1, or invalid
  BEGIN
    _round_number := _round_text::integer;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  IF _round_number IS NULL OR _round_number < 2 OR _round_number > 4 THEN
    RETURN NEW;
  END IF;

  -- Collect the 10 SOW criteria
  _criteria_values := ARRAY[
    NEW.line_score, NEW.shape_score, NEW.form_score,
    NEW.texture_score, NEW.color_palette_score, NEW.space_score,
    NEW.tone_score, NEW.balance_score, NEW.light_score, NEW.depth_score
  ]::numeric[];

  -- Compute average ignoring NULLs (judge may save partial; treat as in-progress)
  SELECT COUNT(v), COALESCE(SUM(v), 0)
    INTO _criteria_count, _criteria_sum
  FROM unnest(_criteria_values) AS v
  WHERE v IS NOT NULL;

  IF _criteria_count = 0 THEN
    _avg := 0;
  ELSE
    _avg := _criteria_sum / _criteria_count;
  END IF;

  _decision := public.derive_decision_from_score(_avg, _round_number);

  IF _decision IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPSERT decision (judge + entry + round + photo_index uniqueness assumed)
  INSERT INTO public.judge_decisions
    (entry_id, judge_id, round_number, decision, photo_index)
  VALUES
    (NEW.entry_id, NEW.judge_id, _round_number, _decision, COALESCE(NEW.photo_index, 0))
  ON CONFLICT (entry_id, judge_id, round_number, photo_index)
  DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();

  RETURN NEW;
END;
$$;

-- Ensure the conflict target exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'judge_decisions'
      AND indexname = 'judge_decisions_unique_per_judge_round_photo'
  ) THEN
    CREATE UNIQUE INDEX judge_decisions_unique_per_judge_round_photo
      ON public.judge_decisions (entry_id, judge_id, round_number, photo_index);
  END IF;
END $$;

-- Drop & recreate trigger
DROP TRIGGER IF EXISTS trg_auto_tier_judge_decision ON public.judge_scores;
CREATE TRIGGER trg_auto_tier_judge_decision
AFTER INSERT OR UPDATE ON public.judge_scores
FOR EACH ROW
EXECUTE FUNCTION public.auto_tier_judge_decision();