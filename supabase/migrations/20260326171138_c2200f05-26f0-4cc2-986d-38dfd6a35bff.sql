
-- TASK 1: Fix competitions.phase default from 'submission' to 'submission_open'
ALTER TABLE public.competitions ALTER COLUMN phase SET DEFAULT 'submission_open';

-- TASK 2: Drop old competition_entries status CHECK and add new one with all judging statuses
ALTER TABLE public.competition_entries DROP CONSTRAINT IF EXISTS competition_entries_status_check;
ALTER TABLE public.competition_entries ADD CONSTRAINT competition_entries_status_check
  CHECK (status = ANY (ARRAY[
    'submitted'::text,
    'approved'::text,
    'rejected'::text,
    'round1_qualified'::text,
    'shortlisted'::text,
    'round2_qualified'::text,
    'finalist'::text,
    'winner'::text,
    'needs_review'::text
  ]));

-- TASK 3: Drop old competitions status CHECK and add new one
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_status_check;
ALTER TABLE public.competitions ADD CONSTRAINT competitions_status_check
  CHECK (status = ANY (ARRAY[
    'upcoming'::text,
    'open'::text,
    'submission_open'::text,
    'judging'::text,
    'result'::text,
    'closed'::text
  ]));

-- TASK 4: Fix competition_entries SELECT RLS
-- Drop old restrictive policy
DROP POLICY IF EXISTS "Anyone can view approved entries" ON public.competition_entries;

-- New policy: public can see entries in public-facing statuses, owners always see own, judges/admins see all
CREATE POLICY "Public can view competition entries" ON public.competition_entries
FOR SELECT USING (
  user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'judge'::app_role)
  OR status IN (
    'submitted', 'approved', 'rejected',
    'round1_qualified', 'shortlisted', 'round2_qualified',
    'finalist', 'winner', 'needs_review'
  )
);
