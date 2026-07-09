-- Step 2.1 — Teach is_qualifying_decision the canonical v3 tokens.
-- Phase R2 of the Judging v3 forensic plan.
--
-- The Step 1.1 CHECK widening + Step 1.4 backfill produced 15 R2 rows with
-- decision='qualified_r3', but this helper still only recognised the
-- earlier 'qualified_for_r3' / 'qualified for r3' string variants.
-- That gap would silently break R3 eligibility.
--
-- This rewrite adds the new tokens while preserving every previously
-- qualifying token. R1 → R2 rule deliberately unchanged (Spec V3:
-- only 'shortlist' advances; 'accept' = R1 certificate, does NOT advance).

CREATE OR REPLACE FUNCTION public.is_qualifying_decision(_decision text, _from_round integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  -- Spec V3 + Phase R2 Step 2.1 (2026-04-30):
  --   R1: ONLY 'shortlist'/'shortlisted' advances to R2.
  --       'accept' = R1 certificate, does NOT advance.
  --   R2: 'qualified_r3' (canonical v3) plus legacy 'shortlist' /
  --       'qualified' / 'qualified_for_r3' / 'qualified for r3' advance to R3.
  --   R3: 'shortlisted_final' (canonical v3) plus legacy 'qualified' /
  --       'shortlist' / 'finalist' / 'shortlisted_for_final' /
  --       'shortlisted for final' advance to R4.
  SELECT CASE
    WHEN _decision IS NULL THEN false
    WHEN _from_round = 1 THEN
      lower(_decision) IN ('shortlist','shortlisted')
    WHEN _from_round = 2 THEN
      lower(_decision) IN (
        'qualified_r3',                     -- canonical v3 (Phase R1)
        'shortlist','shortlisted',
        'qualified',
        'qualified_for_r3','qualified for r3' -- legacy synonyms
      )
    WHEN _from_round = 3 THEN
      lower(_decision) IN (
        'shortlisted_final',                -- canonical v3 (Phase R1)
        'qualified',
        'shortlist','shortlisted',
        'finalist',
        'shortlisted_for_final','shortlisted for final' -- legacy synonyms
      )
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.is_qualifying_decision(text, integer) IS
  'Phase R2 Step 2.1 (2026-04-30): widened to recognise canonical v3 tokens qualified_r3 (R2->R3) and shortlisted_final (R3->R4) introduced by Phase R1 backfill.';