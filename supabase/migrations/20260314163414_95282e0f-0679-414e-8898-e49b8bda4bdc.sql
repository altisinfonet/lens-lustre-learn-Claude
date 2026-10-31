
-- Allow regular users to see tag assignments on their own entries (for stamp display)
CREATE POLICY "Users can view tags on own entries"
ON public.judge_tag_assignments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.competition_entries
    WHERE competition_entries.id = judge_tag_assignments.entry_id
    AND competition_entries.user_id = auth.uid()
  )
);

-- Allow all authenticated users to see active judging tags (for stamp display on entries)
CREATE POLICY "All users can view active tags"
ON public.judging_tags
FOR SELECT
TO authenticated
USING (is_active = true);
