-- Auto-transition competitions whose voting period has ended but phase was never updated
UPDATE public.competitions 
SET phase = 'judging', updated_at = now()
WHERE phase IN ('submission_open', 'voting') 
  AND COALESCE(voting_ends_at, ends_at) < now();