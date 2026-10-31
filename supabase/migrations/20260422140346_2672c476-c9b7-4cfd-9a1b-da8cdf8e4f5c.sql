-- A-01/02/05/07 final: cleanup judging tag duplicates
BEGIN;

-- Disable the protect trigger for the duration of this migration
ALTER TABLE public.judging_tags DISABLE TRIGGER trg_protect_system_tags;

-- Step 1: Remap any assignments from duplicates to canonical tags
UPDATE public.judge_tag_assignments
SET tag_id = '4f1805d5-0a86-4abf-bb27-496da58bd0b2' -- Accepted (R1 canonical)
WHERE tag_id = '259370bb-321d-4481-9581-a13d8babd88d'; -- Qualified for 2nd Round (dup)

UPDATE public.judge_tag_assignments
SET tag_id = '67d446d4-fec6-4f45-8643-03c3ff2d462f' -- Qualified for 3rd Round (R3 canonical)
WHERE tag_id = 'c1faacae-c285-4697-9b30-5ba4ac27c03c'; -- Qualified for Round 3 (dup)

-- Step 2: Remove competition links to duplicates (none exist per audit, defensive)
DELETE FROM public.competition_judging_tags
WHERE tag_id IN (
  '259370bb-321d-4481-9581-a13d8babd88d',
  'c9f3d01e-0d39-4a57-86e2-405e702834a2',
  'c1faacae-c285-4697-9b30-5ba4ac27c03c'
);

-- Step 3: Delete the three duplicate tags
DELETE FROM public.judging_tags
WHERE id IN (
  '259370bb-321d-4481-9581-a13d8babd88d', -- Qualified for 2nd Round
  'c9f3d01e-0d39-4a57-86e2-405e702834a2', -- Qualified for Round 2
  'c1faacae-c285-4697-9b30-5ba4ac27c03c'  -- Qualified for Round 3
);

-- Step 4: Promote canonical progression / verification / rejection tags to system status
UPDATE public.judging_tags
SET is_system = true, is_active = true
WHERE id IN (
  '4f1805d5-0a86-4abf-bb27-496da58bd0b2', -- Accepted
  '67d446d4-fec6-4f45-8643-03c3ff2d462f', -- Qualified for 3rd Round
  'df11381a-1d96-4c46-8439-747ed3a7b0c6', -- Qualified for Final Round
  'bce0e662-76cb-4196-9798-e7d14bd1d782', -- Not Selected for 3rd Round
  '15012bbe-9d46-42e1-8e38-a639a3f5769f', -- Not Selected for Final Round
  'ec03eecf-800d-4028-909c-a11a75033327', -- Verification Required - Round 1
  'c570fc9f-043b-4ee2-8591-fa2389c55812', -- Verification Required - Round 2
  '16f90d24-10d8-46a8-8024-202d1fdd80a0', -- Verification Required - Round 3
  '7ba445d6-fae5-46b4-8656-f281a6b22159', -- Verification Required - Final Round
  '4b440411-1efe-49c4-a9ee-a491a78bdb4d'  -- Rejected
);

-- Re-enable the protect trigger
ALTER TABLE public.judging_tags ENABLE TRIGGER trg_protect_system_tags;

COMMIT;