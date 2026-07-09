-- Drop existing judge INSERT/UPDATE policies on judge_scores and replace with assignment-scoped ones

DROP POLICY IF EXISTS "Judges can insert own scores" ON public.judge_scores;
DROP POLICY IF EXISTS "Judges can update own scores" ON public.judge_scores;
DROP POLICY IF EXISTS "Judges can view scores" ON public.judge_scores;

CREATE POLICY "Judges can insert own scores"
ON public.judge_scores
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_scores.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can update own scores"
ON public.judge_scores
FOR UPDATE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_scores.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can view scores"
ON public.judge_scores
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_scores.entry_id
      AND cj.judge_id = auth.uid()
  )
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- judge_decisions
DROP POLICY IF EXISTS "Judges can insert own decisions" ON public.judge_decisions;
DROP POLICY IF EXISTS "Judges can update own decisions" ON public.judge_decisions;
DROP POLICY IF EXISTS "Judges can view decisions" ON public.judge_decisions;

CREATE POLICY "Judges can insert own decisions"
ON public.judge_decisions
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_decisions.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can update own decisions"
ON public.judge_decisions
FOR UPDATE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_decisions.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can view decisions"
ON public.judge_decisions
FOR SELECT
TO authenticated
USING (
  (has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_decisions.entry_id
      AND cj.judge_id = auth.uid()
  ))
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- judge_tag_assignments
DROP POLICY IF EXISTS "Judges can assign tags" ON public.judge_tag_assignments;
DROP POLICY IF EXISTS "Judges can remove own tag assignments" ON public.judge_tag_assignments;
DROP POLICY IF EXISTS "Judges can view tag assignments" ON public.judge_tag_assignments;

CREATE POLICY "Judges can assign tags"
ON public.judge_tag_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_tag_assignments.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can remove own tag assignments"
ON public.judge_tag_assignments
FOR DELETE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_tag_assignments.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can view tag assignments"
ON public.judge_tag_assignments
FOR SELECT
TO authenticated
USING (
  (has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_tag_assignments.entry_id
      AND cj.judge_id = auth.uid()
  ))
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- judge_comments
DROP POLICY IF EXISTS "Judges can create own comments" ON public.judge_comments;
DROP POLICY IF EXISTS "Judges can update own comments" ON public.judge_comments;
DROP POLICY IF EXISTS "Judges can delete own comments" ON public.judge_comments;
DROP POLICY IF EXISTS "Judges can view all comments" ON public.judge_comments;

CREATE POLICY "Judges can create own comments"
ON public.judge_comments
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_comments.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can update own comments"
ON public.judge_comments
FOR UPDATE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_comments.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can delete own comments"
ON public.judge_comments
FOR DELETE
TO authenticated
USING (
  judge_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_comments.entry_id
      AND cj.judge_id = auth.uid()
  )
);

CREATE POLICY "Judges can view all comments"
ON public.judge_comments
FOR SELECT
TO authenticated
USING (
  (has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.competition_entries ce
    JOIN public.competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_comments.entry_id
      AND cj.judge_id = auth.uid()
  ))
  OR has_role(auth.uid(), 'admin'::app_role)
);
