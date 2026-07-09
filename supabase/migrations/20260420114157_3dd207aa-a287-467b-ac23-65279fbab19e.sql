-- =========================================================================
-- PHASE 1 — VOTE TOTALS INTEGRITY (PHOTO-FIRST, ROOT-LEVEL) — retry
-- =========================================================================

-- 1. Cleanup audit log table
CREATE TABLE IF NOT EXISTS public.vote_adjustment_cleanup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  competition_id uuid NOT NULL,
  photo_index int NOT NULL,
  original_value int NOT NULL,
  new_value int NOT NULL,
  reason text NOT NULL,
  cleaned_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vote_adjustment_cleanup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view cleanup log" ON public.vote_adjustment_cleanup_log;
CREATE POLICY "Admins can view cleanup log"
ON public.vote_adjustment_cleanup_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2. Drop the legacy nonzero check (wrong invariant — blocks neutralizing bad rows)
ALTER TABLE public.admin_vote_adjustments
  DROP CONSTRAINT IF EXISTS adjustment_value_nonzero;

-- 3. Cleanup offending rows: zero them, preserve for audit, log them
WITH offenders AS (
  SELECT id, entry_id, competition_id, photo_index, adjustment_value
  FROM public.admin_vote_adjustments
  WHERE abs(adjustment_value) > 1000
),
logged AS (
  INSERT INTO public.vote_adjustment_cleanup_log
    (adjustment_id, entry_id, competition_id, photo_index, original_value, new_value, reason)
  SELECT id, entry_id, competition_id, photo_index, adjustment_value, 0,
         'Phase 1 cap-policy cleanup — original value ' || adjustment_value::text
         || ' violated new |x|<=1000 policy'
  FROM offenders
  RETURNING adjustment_id
)
UPDATE public.admin_vote_adjustments a
SET adjustment_value = 0,
    reason = COALESCE(a.reason, '') ||
             ' [Phase 1 cleanup: capped from out-of-range value]'
WHERE a.id IN (SELECT adjustment_id FROM logged);

-- 4. Add hard cap as CHECK constraint (immutable, simple, fast)
ALTER TABLE public.admin_vote_adjustments
  ADD CONSTRAINT adjustment_value_within_cap
  CHECK (abs(adjustment_value) <= 1000);

-- 5. Replace entry-level view with PHOTO-GRAIN view
DROP VIEW IF EXISTS public.entry_final_votes_legacy;
DROP VIEW IF EXISTS public.entry_final_votes CASCADE;

CREATE VIEW public.entry_final_votes AS
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

-- 6. Transitional entry-level rollup view (deprecated — for legacy callers only)
CREATE VIEW public.entry_final_votes_legacy AS
SELECT
  entry_id,
  SUM(real_votes)::int        AS real_votes,
  SUM(adjustment_total)::int  AS adjustment_total,
  SUM(final_votes)::int       AS final_votes
FROM public.entry_final_votes
GROUP BY entry_id;

COMMENT ON VIEW public.entry_final_votes_legacy IS
'DEPRECATED entry-level rollup — use entry_final_votes (photo-grain) for all new code. Phase 1 transitional only.';