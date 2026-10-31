
-- HOTFIX-G: judge-comments-and-tags-owner-safe v2
-- Remove broad owner SELECT on raw judge_comments / judge_tag_assignments
-- (exposes judge_id pre-publication). Replace with publish-gated
-- security_invoker views that project NO judge_id.

CREATE OR REPLACE VIEW public.judge_comments_owner_safe
WITH (security_invoker = on) AS
SELECT
  jc.id,
  jc.entry_id,
  jc.photo_index,
  jc.comment,
  jc.created_at
FROM public.judge_comments jc
WHERE EXISTS (
  SELECT 1
  FROM public.competition_entries ce
  JOIN public.competition_round_publish crp
    ON crp.competition_id = ce.competition_id
  WHERE ce.id = jc.entry_id
    AND ce.user_id = auth.uid()
    AND crp.published_at IS NOT NULL
);

CREATE OR REPLACE VIEW public.judge_tag_assignments_owner_safe
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
  SELECT 1
  FROM public.competition_entries ce
  JOIN public.competition_round_publish crp
    ON crp.competition_id = ce.competition_id
  WHERE ce.id = jta.entry_id
    AND ce.user_id = auth.uid()
    AND crp.published_at IS NOT NULL
);

GRANT SELECT ON public.judge_comments_owner_safe TO authenticated;
GRANT SELECT ON public.judge_tag_assignments_owner_safe TO authenticated;

-- Drop the broad owner SELECT policies (exposed judge_id pre-publication).
-- Judge/admin/public-R4 policies are preserved.
DROP POLICY IF EXISTS "Users can view comments on own entries" ON public.judge_comments;
DROP POLICY IF EXISTS "Users can view tags on own entries" ON public.judge_tag_assignments;
