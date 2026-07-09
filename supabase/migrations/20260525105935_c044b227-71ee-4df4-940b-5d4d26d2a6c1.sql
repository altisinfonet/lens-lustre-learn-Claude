-- B-3: Tighten entry_score_cache SELECT to admin/judge/owner
DROP POLICY IF EXISTS "Authenticated users can read score cache" ON public.entry_score_cache;

CREATE POLICY "Admins read score cache"
  ON public.entry_score_cache FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Judges read score cache"
  ON public.entry_score_cache FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'judge'));

CREATE POLICY "Entry owners read own score cache"
  ON public.entry_score_cache FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_entries ce
    WHERE ce.id = entry_score_cache.entry_id
      AND ce.user_id = auth.uid()
  ));