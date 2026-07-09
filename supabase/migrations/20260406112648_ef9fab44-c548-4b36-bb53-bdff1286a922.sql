-- Fix tags with NULL or empty visible_in_round based on label patterns
UPDATE judging_tags SET visible_in_round = ARRAY[2]
WHERE (visible_in_round IS NULL OR array_length(visible_in_round, 1) IS NULL)
  AND label ILIKE '%Top 100%';

UPDATE judging_tags SET visible_in_round = ARRAY[3]
WHERE (visible_in_round IS NULL OR array_length(visible_in_round, 1) IS NULL)
  AND label ILIKE '%Top 50%';

UPDATE judging_tags SET visible_in_round = ARRAY[4]
WHERE (visible_in_round IS NULL OR array_length(visible_in_round, 1) IS NULL)
  AND (label ILIKE '%Winner%' OR label ILIKE '%Runner%' OR label ILIKE '%Jury%' OR label ILIKE '%Honour%');

-- Safety default: any remaining NULL/empty gets assigned to round 2
UPDATE judging_tags SET visible_in_round = ARRAY[2]
WHERE visible_in_round IS NULL OR array_length(visible_in_round, 1) IS NULL;

-- Enforce NOT NULL going forward
ALTER TABLE judging_tags ALTER COLUMN visible_in_round SET NOT NULL;