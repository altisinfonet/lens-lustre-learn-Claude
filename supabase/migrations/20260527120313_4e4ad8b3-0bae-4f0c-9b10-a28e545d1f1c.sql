-- FIX A: publish-gated owner-safe decisions view
CREATE OR REPLACE VIEW public.judge_decisions_owner_safe
WITH (security_invoker=on)
AS
SELECT
  jd.entry_id,
  jd.photo_index,
  jd.decision,
  jd.round_number
FROM public.judge_decisions jd
WHERE EXISTS (
  SELECT 1
  FROM public.competition_round_publish crp
  JOIN public.competition_entries ce
    ON ce.competition_id = crp.competition_id
  WHERE ce.id = jd.entry_id
    AND crp.round_number = jd.round_number
    AND crp.published_at IS NOT NULL
);

DROP POLICY IF EXISTS
"Entry owners can view own decisions via safe view"
ON public.judge_decisions;

-- FIX B: remove unused owner score-cache exposure
DROP POLICY IF EXISTS
"Entry owners read own score cache"
ON public.entry_score_cache;