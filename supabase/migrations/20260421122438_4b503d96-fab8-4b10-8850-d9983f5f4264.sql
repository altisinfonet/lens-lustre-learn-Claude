-- Judging v5 / Phase: Strict per-round publish gate
-- Upgrade entry_public_status view: each status gated by its source round's published_at.

DROP VIEW IF EXISTS public.entry_public_status;

CREATE VIEW public.entry_public_status
WITH (security_invoker = on)
AS
SELECT
  e.id AS entry_id,
  e.competition_id,
  -- public_status: hide until the producing round is published
  CASE
    WHEN e.status IN ('winner','finalist') AND EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL
    ) THEN e.status
    WHEN e.status = 'shortlisted' AND EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.round_number = 3 AND p.published_at IS NOT NULL
    ) THEN e.status
    WHEN e.status = 'round2_qualified' AND EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.round_number = 2 AND p.published_at IS NOT NULL
    ) THEN e.status
    WHEN e.status IN ('round1_qualified','rejected') AND EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.round_number = 1 AND p.published_at IS NOT NULL
    ) THEN e.status
    -- "submitted" / "needs_review" / unknown → harmless to expose
    WHEN e.status IN ('submitted','needs_review') THEN e.status
    ELSE 'judging_in_progress'::text
  END AS public_status,
  -- public_round: only meaningful once at least one round is published
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL
    ) THEN e.current_round
    ELSE NULL
  END AS public_round,
  -- public_placement: gated on R4 published (placements only meaningful after finals)
  CASE
    WHEN e.placement IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL
    ) THEN e.placement
    ELSE NULL
  END AS public_placement
FROM public.competition_entries e;

GRANT SELECT ON public.entry_public_status TO anon, authenticated;