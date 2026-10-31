-- Fix D1 (audit 2026-07-04): widen the SELECT policy on competition_entries so
-- entries carrying legacy "roundN_qualified" statuses are visible to authenticated
-- users the same way "shortlisted" / "qualified" already are. Purely additive.
-- No data mutation.
DROP POLICY IF EXISTS "Authenticated can view public-status entries" ON public.competition_entries;

CREATE POLICY "Authenticated can view public-status entries"
  ON public.competition_entries
  FOR SELECT
  USING (
    status = ANY (ARRAY[
      'submitted'::text,
      'approved'::text,
      'winner'::text,
      'runner_up'::text,
      'honorary'::text,
      'finalist'::text,
      'shortlisted'::text,
      'qualified'::text,
      'round1_qualified'::text,
      'round2_qualified'::text,
      'round3_qualified'::text
    ])
  );