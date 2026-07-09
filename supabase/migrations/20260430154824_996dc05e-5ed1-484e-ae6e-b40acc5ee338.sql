-- Phase 5 / Step 5.1 — read-only helper RPC
-- Lists entries in a given competition+round whose photo decisions are not all final.
-- Strictly read-safe: no DDL on existing objects, no writes, no changes to any_photo_pending.

CREATE OR REPLACE FUNCTION public.get_round_pending_entries(
  p_competition_id uuid,
  p_round int
)
RETURNS TABLE(entry_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM public.competition_entries e
  WHERE e.competition_id = p_competition_id
    AND NULLIF(regexp_replace(COALESCE(e.current_round, ''), '[^0-9]', '', 'g'), '')::int = p_round
    AND public.any_photo_pending(e.id) = TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_round_pending_entries(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_round_pending_entries(uuid, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_round_pending_entries(uuid, int) IS
  'Phase 5 admin pending-gate helper. Returns entry ids in (competition, round) where any_photo_pending() = true. Read-only.';