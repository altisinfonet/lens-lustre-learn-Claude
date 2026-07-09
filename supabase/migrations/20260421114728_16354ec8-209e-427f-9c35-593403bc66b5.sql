
DROP VIEW IF EXISTS public.entry_public_status;

CREATE VIEW public.entry_public_status
WITH (security_invoker = true) AS
SELECT
  e.id AS entry_id,
  e.competition_id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL
    ) THEN e.status
    ELSE 'judging_in_progress'
  END AS public_status,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL
    ) THEN e.current_round
    ELSE NULL
  END AS public_round
FROM public.competition_entries e;

GRANT SELECT ON public.entry_public_status TO anon, authenticated;
