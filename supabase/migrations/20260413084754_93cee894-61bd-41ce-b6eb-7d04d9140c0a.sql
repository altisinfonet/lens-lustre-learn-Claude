
-- Step 1: Add photo_index column
ALTER TABLE public.judge_decisions
ADD COLUMN IF NOT EXISTS photo_index INTEGER NOT NULL DEFAULT 0;

-- Step 2: Drop old unique constraint
-- The constraint name is auto-generated; find and drop it
DO $$
DECLARE
  _constraint_name text;
BEGIN
  SELECT conname INTO _constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.judge_decisions'::regclass
    AND contype = 'u'
    AND array_length(conkey, 1) = 3
  LIMIT 1;
  
  IF _constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.judge_decisions DROP CONSTRAINT %I', _constraint_name);
  END IF;
END;
$$;

-- Step 3: Add new unique constraint including photo_index
ALTER TABLE public.judge_decisions
ADD CONSTRAINT judge_decisions_entry_judge_round_photo_unique
UNIQUE (entry_id, judge_id, round_number, photo_index);

-- Step 4: Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_judge_decisions_entry_photo
ON public.judge_decisions (entry_id, photo_index);
