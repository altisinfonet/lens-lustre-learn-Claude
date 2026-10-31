BEGIN;

CREATE OR REPLACE VIEW public.judge_tag_assignments_public_r4
WITH (security_invoker = on) AS
SELECT
  jta.id,
  jta.entry_id,
  jta.tag_id,
  jta.photo_index,
  jta.round_number,
  jta.created_at
FROM public.judge_tag_assignments jta
WHERE EXISTS (
  SELECT 1 FROM public.judging_tags jt
  WHERE jt.id = jta.tag_id
    AND jt.label = ANY (ARRAY[
      'Top 100','Top 50','Winner',
      '1st Runner-Up','2nd Runner-Up',
      'Honorary Mention','Special Jury'])
)
AND EXISTS (
  SELECT 1
  FROM public.competition_entries ce
  JOIN public.competition_round_publish crp
    ON crp.competition_id = ce.competition_id
  WHERE ce.id = jta.entry_id
    AND crp.round_number = 4
    AND crp.published_at IS NOT NULL
);

GRANT SELECT ON public.judge_tag_assignments_public_r4 TO anon, authenticated;

DROP POLICY "Public can read R4 award tag assignments on published rounds"
  ON public.judge_tag_assignments;

COMMIT;