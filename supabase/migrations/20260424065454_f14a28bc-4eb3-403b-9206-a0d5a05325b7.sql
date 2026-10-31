-- Single publish-gated status endpoint.
-- Consumers (Judge, Admin, User panels) MUST read entry visibility ONLY through this function.
-- Reading raw competition_entries.status / placement / progression_decision in UI is forbidden.

CREATE OR REPLACE FUNCTION public.get_gated_entry_status(p_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  competition_id uuid,
  public_status text,
  public_round text,
  public_placement text,
  public_progression_note text,
  has_pending_verification boolean,
  verification_overrides_status boolean,
  is_published_any_round boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      eps.entry_id,
      eps.competition_id,
      eps.public_status,
      eps.public_round,
      eps.public_placement,
      eps.public_progression_note
    FROM public.entry_public_status eps
    WHERE eps.entry_id = ANY(p_entry_ids)
  ),
  pending_ver AS (
    -- Open verification holds (pending OR submitted-awaiting-admin) — always visible
    SELECT entry_id, COUNT(*)::int AS n
    FROM public.photo_verification_requests
    WHERE entry_id = ANY(p_entry_ids)
      AND status IN ('pending', 'submitted')
      AND (expires_at IS NULL OR expires_at > now())
    GROUP BY entry_id
  ),
  any_pub AS (
    SELECT competition_id, bool_or(published_at IS NOT NULL) AS pub
    FROM public.competition_round_publish
    WHERE competition_id IN (SELECT competition_id FROM base)
    GROUP BY competition_id
  )
  SELECT
    b.entry_id,
    b.competition_id,
    b.public_status,
    b.public_round,
    b.public_placement,
    b.public_progression_note,
    COALESCE(pv.n, 0) > 0 AS has_pending_verification,
    -- Verification ALWAYS wins over progression in the UI when there is an open hold
    COALESCE(pv.n, 0) > 0 AS verification_overrides_status,
    COALESCE(ap.pub, false) AS is_published_any_round
  FROM base b
  LEFT JOIN pending_ver pv ON pv.entry_id = b.entry_id
  LEFT JOIN any_pub ap ON ap.competition_id = b.competition_id;
$$;

REVOKE ALL ON FUNCTION public.get_gated_entry_status(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_gated_entry_status(uuid[]) TO anon, authenticated;

COMMENT ON FUNCTION public.get_gated_entry_status(uuid[]) IS
'Single source of truth for publish-gated entry visibility. All UI surfaces (Judge, Admin, User) MUST read entry status through this function — never directly from competition_entries.status. Combines entry_public_status + photo_verification_requests + competition_round_publish so verification holds and unpublished rounds cannot leak.';
