-- Block A: R2/R3 button label fixes + retire illegal "Not Selected" auto-derived buttons
-- Locked answers: Hybrid verb (judge="Shortlist for X", participant="Qualified for X"),
-- r1_needs_verification only, r4_finalist key kept with participant label "Qualified for Final"

BEGIN;

-- System-tag protection triggers block label/active changes; bypass in-transaction only.
ALTER TABLE public.judging_tags DISABLE TRIGGER protect_system_tags;
ALTER TABLE public.judging_tags DISABLE TRIGGER trg_protect_system_tags;

-- 1. R2: deactivate illegal "Not Selected for 3rd Round" (auto-derived, not a judge button)
UPDATE public.judging_tags
SET is_active = false
WHERE id = 'bce0e662-76cb-4196-9798-e7d14bd1d782'
  AND label = 'Not Selected for 3rd Round'
  AND visible_in_round = ARRAY[2];

-- 2. R3: deactivate illegal "Not Selected for Final Round" (auto-derived)
UPDATE public.judging_tags
SET is_active = false
WHERE id = '15012bbe-9d46-42e1-8e38-a639a3f5769f'
  AND label = 'Not Selected for Final Round'
  AND visible_in_round = ARRAY[3];

-- 3. R2: rename "Accepted" -> "Accept for Round 2" (judge button label)
UPDATE public.judging_tags
SET label = 'Accept for Round 2'
WHERE id = 'bd4bbf62-94ac-47fa-a019-2363b49a1ec9'
  AND label = 'Accepted'
  AND visible_in_round = ARRAY[2];

-- 4. R2: rename "Qualified for 3rd Round" -> "Shortlist for Round 3" (judge button verb)
UPDATE public.judging_tags
SET label = 'Shortlist for Round 3'
WHERE id = '67d446d4-fec6-4f45-8643-03c3ff2d462f'
  AND label = 'Qualified for 3rd Round'
  AND visible_in_round = ARRAY[2];

-- 5. R3: rename "Accepted" -> "Accept for Round 3"
UPDATE public.judging_tags
SET label = 'Accept for Round 3'
WHERE id = '1e786c51-cf1b-4790-b39f-10e74e2e74e6'
  AND label = 'Accepted'
  AND visible_in_round = ARRAY[3];

-- 6. R3: rename "Qualified for Final Round" -> "Shortlist for Final Round"
UPDATE public.judging_tags
SET label = 'Shortlist for Final Round'
WHERE id = 'df11381a-1d96-4c46-8439-747ed3a7b0c6'
  AND label = 'Qualified for Final Round'
  AND visible_in_round = ARRAY[3];

-- Re-enable triggers
ALTER TABLE public.judging_tags ENABLE TRIGGER protect_system_tags;
ALTER TABLE public.judging_tags ENABLE TRIGGER trg_protect_system_tags;

-- 7. Catalog: r4_finalist participant label -> "Qualified for Final" (locked answer)
UPDATE public.v3_stage_catalog
SET tag_label_canonical = 'Qualified for Final',
    description = 'R4 finalist (no placement) — participant sees "Qualified for Final"'
WHERE stage_key = 'r4_finalist';

-- 8. Standardize R2 catalog participant label to match: "Qualified for Round 3" (already correct, idempotent)
UPDATE public.v3_stage_catalog
SET tag_label_canonical = 'Qualified for Round 3'
WHERE stage_key = 'r2_qualified_r3';

-- 9. Standardize R3 catalog participant label: "Qualified for Final Round" -> keep but unify spacing
UPDATE public.v3_stage_catalog
SET tag_label_canonical = 'Qualified for Final Round'
WHERE stage_key = 'r3_qualified_final';

-- 10. Confirm r1_needs_review stays inactive (locked: r1_needs_verification only)
UPDATE public.v3_stage_catalog
SET is_active = false
WHERE stage_key = 'r1_needs_review' AND is_active = true;

COMMIT;