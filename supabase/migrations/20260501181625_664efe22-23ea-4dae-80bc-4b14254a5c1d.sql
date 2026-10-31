CREATE OR REPLACE FUNCTION public.is_qualifying_decision(_decision text, _from_round integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _decision IS NULL THEN false
    WHEN _from_round = 1 THEN
      lower(_decision) IN ('shortlist','shortlisted')
    WHEN _from_round = 2 THEN
      lower(_decision) IN (
        'qualified_r3',
        'shortlist','shortlisted',
        'qualified',
        'qualified_for_r3','qualified for r3'
      )
    WHEN _from_round = 3 THEN
      lower(_decision) IN (
        'qualified_final',
        'shortlisted_final',
        'qualified',
        'shortlist','shortlisted',
        'finalist',
        'shortlisted_for_final','shortlisted for final'
      )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.any_photo_pending(p_entry_id uuid, p_round_number integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ent AS (
    SELECT ce.id, ce.competition_id, p_round_number AS r
    FROM public.competition_entries ce
    WHERE ce.id = p_entry_id
      AND p_round_number BETWEEN 1 AND 4
  ),
  expected AS (
    SELECT gp.entry_id, gp.photo_index, e.r
    FROM ent e
    JOIN LATERAL public.get_round_eligible_photos(e.competition_id, e.r) gp
      ON gp.entry_id = e.id
  ),
  decided AS (
    SELECT DISTINCT x.entry_id, x.photo_index
    FROM expected x
    JOIN public.judge_decisions jd
      ON jd.entry_id = x.entry_id
     AND COALESCE(jd.photo_index, 0) = x.photo_index
     AND jd.round_number = x.r
    JOIN public.v3_stage_catalog c
      ON c.decision_token = jd.decision
     AND c.round_number = jd.round_number
     AND c.is_active = true
  )
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM expected x
      LEFT JOIN decided d
        ON d.entry_id = x.entry_id
       AND d.photo_index = x.photo_index
      WHERE d.entry_id IS NULL
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.any_photo_pending(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ent AS (
    SELECT NULLIF(regexp_replace(COALESCE(ce.current_round, ''), '[^0-9]', '', 'g'), '')::int AS r
    FROM public.competition_entries ce
    WHERE ce.id = p_entry_id
  )
  SELECT COALESCE(public.any_photo_pending(p_entry_id, (SELECT r FROM ent)), false);
$$;

CREATE OR REPLACE FUNCTION public.enforce_progression_decision_pending_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate_round int;
BEGIN
  IF NEW.progression_decision IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.progression_decision IS NOT DISTINCT FROM OLD.progression_decision THEN
    RETURN NEW;
  END IF;

  v_gate_round := NULLIF(substring(NEW.progression_decision from '^r([1-4])_'), '')::int;
  IF v_gate_round IS NULL THEN
    v_gate_round := NULLIF(regexp_replace(COALESCE(NEW.current_round, OLD.current_round, ''), '[^0-9]', '', 'g'), '')::int;
  END IF;

  IF v_gate_round IS NOT NULL AND public.any_photo_pending(NEW.id, v_gate_round) THEN
    RAISE EXCEPTION
      'progression_decision cannot be set to % while entry % has pending photos in judged round % (any_photo_pending = TRUE). Phase 3 Step 4 gate.',
      NEW.progression_decision, NEW.id, v_gate_round
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.competition_entries ce
SET progression_decision = 'r3_qualified_final'
WHERE ce.progression_decision = 'r3_accepted'
  AND EXISTS (
    SELECT 1
    FROM public.judge_decisions jd
    WHERE jd.entry_id = ce.id
      AND jd.round_number = 3
      AND jd.decision IN ('qualified_final','shortlisted_final','shortlist','shortlisted')
  );

COMMENT ON FUNCTION public.is_qualifying_decision(text, integer) IS
'Round eligibility helper. Round 3 canonical final-qualification token is qualified_final.';

COMMENT ON FUNCTION public.any_photo_pending(uuid, integer) IS
'Checks whether an entry has pending eligible photos for the specified judging round, independent of the entry current_round after promotion.';

COMMENT ON FUNCTION public.enforce_progression_decision_pending_gate() IS
'Blocks progression_decision writes only when the round encoded in that progression decision still has pending eligible photos; avoids checking the next round during promotion.';