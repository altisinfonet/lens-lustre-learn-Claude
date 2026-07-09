
-- Fix security definer view warning
DROP VIEW IF EXISTS public.entry_final_votes;
CREATE VIEW public.entry_final_votes WITH (security_invoker = true) AS
SELECT
  ce.id AS entry_id,
  ce.competition_id,
  COALESCE(v.real_votes, 0) AS real_votes,
  COALESCE(a.adjustment_total, 0) AS adjustment_total,
  COALESCE(v.real_votes, 0) + COALESCE(a.adjustment_total, 0) AS final_votes
FROM public.competition_entries ce
LEFT JOIN (
  SELECT entry_id, COUNT(*)::integer AS real_votes
  FROM public.competition_votes
  GROUP BY entry_id
) v ON v.entry_id = ce.id
LEFT JOIN (
  SELECT entry_id, SUM(adjustment_value)::integer AS adjustment_total
  FROM public.admin_vote_adjustments
  GROUP BY entry_id
) a ON a.entry_id = ce.id;
