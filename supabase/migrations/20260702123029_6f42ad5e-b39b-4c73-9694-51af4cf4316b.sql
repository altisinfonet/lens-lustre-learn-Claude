DROP POLICY IF EXISTS "Judges can insert own sessions" ON public.judge_sessions;

CREATE POLICY "Judges can insert own sessions"
  ON public.judge_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    judge_id = auth.uid()
    AND (
      has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.competition_judges cj
        WHERE cj.judge_id = auth.uid()
          AND cj.competition_id = judge_sessions.competition_id
      )
    )
  );