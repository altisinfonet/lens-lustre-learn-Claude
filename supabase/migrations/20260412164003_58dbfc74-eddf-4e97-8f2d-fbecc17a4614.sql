-- Step 1: Add photo_index column
ALTER TABLE public.competition_votes
ADD COLUMN photo_index integer NOT NULL DEFAULT 0;

-- Step 2: Drop old unique constraint (entry_id, user_id)
-- Find and drop the constraint
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'competition_votes'
    AND tc.constraint_type = 'UNIQUE'
  LIMIT 1;
  
  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.competition_votes DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

-- Step 3: Add new unique constraint on (entry_id, user_id, photo_index)
ALTER TABLE public.competition_votes
ADD CONSTRAINT competition_votes_entry_user_photo_unique
UNIQUE (entry_id, user_id, photo_index);

-- Step 4: Add index for efficient per-photo lookups
CREATE INDEX IF NOT EXISTS idx_competition_votes_entry_photo 
ON public.competition_votes (entry_id, photo_index);