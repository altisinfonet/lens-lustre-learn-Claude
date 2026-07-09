ALTER VIEW public.entry_public_status SET (security_invoker = true);

DROP POLICY IF EXISTS "Public can read R4 award tag assignments on published rounds" ON public.judge_tag_assignments;
CREATE POLICY "Public can read R4 award tag assignments on published rounds"
ON public.judge_tag_assignments
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.judging_tags jt
    WHERE jt.id = judge_tag_assignments.tag_id
      AND jt.label IN (
        'Top 100','Top 50','Winner',
        '1st Runner-Up','2nd Runner-Up',
        'Honorary Mention','Special Jury'
      )
  )
  AND EXISTS (
    SELECT 1
    FROM public.competition_entries ce
    JOIN public.competition_round_publish crp
      ON crp.competition_id = ce.competition_id
    WHERE ce.id = judge_tag_assignments.entry_id
      AND crp.round_number = 4
      AND crp.published_at IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Public can read R4 award tag definitions" ON public.judging_tags;
CREATE POLICY "Public can read R4 award tag definitions"
ON public.judging_tags
FOR SELECT
TO anon, authenticated
USING (
  label IN (
    'Top 100','Top 50','Winner',
    '1st Runner-Up','2nd Runner-Up',
    'Honorary Mention','Special Jury'
  )
);