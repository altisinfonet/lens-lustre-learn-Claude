CREATE OR REPLACE FUNCTION public.is_qualifying_decision(_decision text, _from_round integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Spec V3:
  --   R1: ONLY 'shortlist' advances to R2. 'accept' = R1 certificate, does NOT advance.
  --   R2: 'qualified for R3' / 'shortlist' advances to R3.
  --   R3: 'shortlisted for final' / 'qualified' / 'finalist' advances to R4.
  SELECT CASE
    WHEN _decision IS NULL THEN false
    WHEN _from_round = 1 THEN lower(_decision) IN ('shortlist','shortlisted')
    WHEN _from_round = 2 THEN lower(_decision) IN ('shortlist','shortlisted','qualified','qualified_for_r3','qualified for r3')
    WHEN _from_round = 3 THEN lower(_decision) IN ('qualified','shortlist','shortlisted','finalist','shortlisted_for_final','shortlisted for final')
    ELSE false
  END;
$function$;