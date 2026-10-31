CREATE OR REPLACE FUNCTION public.progression_order(_stage_key text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (round_number * 100)
              + CASE family
                  -- Round-1 vocabulary
                  WHEN 'needs_review'      THEN 1
                  WHEN 'verification'      THEN 2
                  -- Cross-round progression
                  WHEN 'progression_pass'  THEN 5  -- accepted/qualified/shortlisted (forward)
                  WHEN 'progression_fail'  THEN 8  -- not_selected_*  (terminal-fail in round)
                  WHEN 'rejection'         THEN 9  -- rejected (terminal)
                  -- R4 awards (all forward, ranked by prestige)
                  WHEN 'award'             THEN 10
                  ELSE 0
                END
       FROM public.v3_stage_catalog
      WHERE stage_key = _stage_key
        AND is_active = true
      LIMIT 1),
    0
  );
$$;