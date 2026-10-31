
-- =============================================================
-- F-01 Phase D — RLS round-lock defense-in-depth
-- =============================================================

-- 1) Helper: round-open check keyed by (entry_id, round_number)
CREATE OR REPLACE FUNCTION public.judge_round_open_by_number(_entry_id uuid, _round_number int)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.judging_rounds jr
    JOIN public.competition_entries ce ON ce.competition_id = jr.competition_id
    WHERE ce.id = _entry_id
      AND jr.round_number = _round_number
      AND jr.status = 'completed'
  );
$$;

-- 2) Helper: round-open check keyed by round_id (used by judge_comments)
CREATE OR REPLACE FUNCTION public.judge_round_open_by_id(_round_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- NULL round_id means "no specific round" — treat as open (matches existing client behavior)
  SELECT _round_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.judging_rounds jr
    WHERE jr.id = _round_id
      AND jr.status = 'completed'
  );
$$;

GRANT EXECUTE ON FUNCTION public.judge_round_open_by_number(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.judge_round_open_by_id(uuid) TO authenticated;

-- =============================================================
-- 3) judge_scores — INSERT / UPDATE / DELETE
-- =============================================================
DROP POLICY IF EXISTS "Judges can insert own scores" ON public.judge_scores;
CREATE POLICY "Judges can insert own scores"
ON public.judge_scores
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
);

DROP POLICY IF EXISTS "Judges can update own scores" ON public.judge_scores;
CREATE POLICY "Judges can update own scores"
ON public.judge_scores
FOR UPDATE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
)
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
);

DROP POLICY IF EXISTS "Judges can delete own scores" ON public.judge_scores;
CREATE POLICY "Judges can delete own scores"
ON public.judge_scores
FOR DELETE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
);

-- =============================================================
-- 4) judge_decisions — INSERT / UPDATE (no DELETE policy existed)
-- =============================================================
DROP POLICY IF EXISTS "Judges can insert own decisions" ON public.judge_decisions;
CREATE POLICY "Judges can insert own decisions"
ON public.judge_decisions
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
);

DROP POLICY IF EXISTS "Judges can update own decisions" ON public.judge_decisions;
CREATE POLICY "Judges can update own decisions"
ON public.judge_decisions
FOR UPDATE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
)
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
);

-- =============================================================
-- 5) judge_tag_assignments — INSERT / DELETE (no UPDATE policy existed)
-- =============================================================
DROP POLICY IF EXISTS "Judges can assign tags" ON public.judge_tag_assignments;
CREATE POLICY "Judges can assign tags"
ON public.judge_tag_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
);

DROP POLICY IF EXISTS "Judges can remove own tag assignments" ON public.judge_tag_assignments;
CREATE POLICY "Judges can remove own tag assignments"
ON public.judge_tag_assignments
FOR DELETE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_number(entry_id, round_number)
);

-- =============================================================
-- 6) judge_comments — INSERT / UPDATE / DELETE  (round_id, not round_number)
-- =============================================================
DROP POLICY IF EXISTS "Judges can create own comments" ON public.judge_comments;
CREATE POLICY "Judges can create own comments"
ON public.judge_comments
FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_id(round_id)
);

DROP POLICY IF EXISTS "Judges can update own comments" ON public.judge_comments;
CREATE POLICY "Judges can update own comments"
ON public.judge_comments
FOR UPDATE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_id(round_id)
)
WITH CHECK (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_id(round_id)
);

DROP POLICY IF EXISTS "Judges can delete own comments" ON public.judge_comments;
CREATE POLICY "Judges can delete own comments"
ON public.judge_comments
FOR DELETE
TO authenticated
USING (
  judge_id = auth.uid()
  AND has_role(auth.uid(), 'judge'::app_role)
  AND judge_can_access_entry(entry_id, auth.uid())
  AND public.judge_round_open_by_id(round_id)
);
