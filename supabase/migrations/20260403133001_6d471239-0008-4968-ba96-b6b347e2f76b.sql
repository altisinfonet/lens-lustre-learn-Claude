-- P1: Drop the UNSCOPED duplicate INSERT policy on judge_scores
-- This policy allowed any judge to score any entry regardless of competition assignment
DROP POLICY IF EXISTS "Judges can insert scores" ON public.judge_scores;

-- P2: Drop the unscoped DELETE policy and replace with competition-scoped version
DROP POLICY IF EXISTS "Judges can delete own scores" ON public.judge_scores;

CREATE POLICY "Judges can delete own scores"
ON public.judge_scores
FOR DELETE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_judges cj ON cj.competition_id = ce.competition_id
    WHERE ce.id = judge_scores.entry_id
      AND cj.judge_id = auth.uid()
  )
);

-- P3: Strengthen judging_tags INSERT policy to enforce created_by = auth.uid()
DROP POLICY IF EXISTS "Judges can create quality tags" ON public.judging_tags;

CREATE POLICY "Judges can create quality tags"
ON public.judging_tags
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (has_role(auth.uid(), 'judge'::text) OR has_role(auth.uid(), 'admin'::text))
);