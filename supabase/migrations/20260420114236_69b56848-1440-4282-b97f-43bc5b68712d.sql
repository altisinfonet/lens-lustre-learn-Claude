-- Recreate views with security_invoker=true to honor caller RLS
DROP VIEW IF EXISTS public.entry_final_votes_legacy;
DROP VIEW IF EXISTS public.entry_final_votes CASCADE;

CREATE VIEW public.entry_final_votes
WITH (security_invoker = true) AS
WITH photo_keys AS (
  SELECT entry_id, photo_index FROM public.competition_votes
  UNION
  SELECT entry_id, photo_index FROM public.admin_vote_adjustments
),
real_counts AS (
  SELECT entry_id, photo_index, COUNT(*)::int AS real_votes
  FROM public.competition_votes
  GROUP BY entry_id, photo_index
),
adj_sums AS (
  SELECT entry_id, photo_index, COALESCE(SUM(adjustment_value), 0)::int AS adjustment_total
  FROM public.admin_vote_adjustments
  GROUP BY entry_id, photo_index
)
SELECT
  pk.entry_id,
  pk.photo_index,
  COALESCE(rc.real_votes, 0) AS real_votes,
  COALESCE(asu.adjustment_total, 0) AS adjustment_total,
  GREATEST(0, COALESCE(rc.real_votes, 0) + COALESCE(asu.adjustment_total, 0)) AS final_votes
FROM photo_keys pk
LEFT JOIN real_counts rc
  ON rc.entry_id = pk.entry_id AND rc.photo_index = pk.photo_index
LEFT JOIN adj_sums asu
  ON asu.entry_id = pk.entry_id AND asu.photo_index = pk.photo_index;

COMMENT ON VIEW public.entry_final_votes IS
'PHOTO-GRAIN authoritative final-vote view. Keyed on (entry_id, photo_index). final_votes = real_votes + adjustment_total, floored at 0. SOW: One Image, One Card, One Vote.';

CREATE VIEW public.entry_final_votes_legacy
WITH (security_invoker = true) AS
SELECT
  entry_id,
  SUM(real_votes)::int        AS real_votes,
  SUM(adjustment_total)::int  AS adjustment_total,
  SUM(final_votes)::int       AS final_votes
FROM public.entry_final_votes
GROUP BY entry_id;

COMMENT ON VIEW public.entry_final_votes_legacy IS
'DEPRECATED entry-level rollup — use entry_final_votes (photo-grain) for all new code. Phase 1 transitional only.';