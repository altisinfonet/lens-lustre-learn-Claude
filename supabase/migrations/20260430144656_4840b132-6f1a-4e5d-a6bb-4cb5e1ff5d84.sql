
CREATE OR REPLACE FUNCTION public.get_gated_entry_status(p_entry_ids uuid[])
RETURNS TABLE(
  entry_id uuid,
  competition_id uuid,
  public_status text,
  public_round text,
  public_placement text,
  public_progression_note text,
  public_r4_tags text[],
  has_pending_verification boolean,
  verification_overrides_status boolean,
  is_published_any_round boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT eps.entry_id, eps.competition_id, eps.public_status, eps.public_round,
           eps.public_placement, eps.public_progression_note, eps.public_r4_tags
    FROM public.entry_public_status eps
    WHERE eps.entry_id = ANY(p_entry_ids)
  ),
  pending AS (
    -- Phase 3 · Step 2: per-entry pending evaluation
    SELECT b.entry_id, public.any_photo_pending(b.entry_id) AS is_pending
    FROM base b
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
    -- HARD GATE: pending overrides any final result
    CASE WHEN p.is_pending THEN 'judging_in_progress'::text ELSE b.public_status END AS public_status,
    b.public_round,
    CASE WHEN p.is_pending THEN NULL::text       ELSE b.public_placement END AS public_placement,
    CASE WHEN p.is_pending THEN NULL::text       ELSE b.public_progression_note END AS public_progression_note,
    CASE WHEN p.is_pending THEN NULL::text[]     ELSE b.public_r4_tags END AS public_r4_tags,
    FALSE AS has_pending_verification,
    FALSE AS verification_overrides_status,
    COALESCE(ap.pub, FALSE) AS is_published_any_round
  FROM base b
  JOIN pending p USING (entry_id)
  LEFT JOIN any_pub ap USING (competition_id);
$function$;

COMMENT ON FUNCTION public.get_gated_entry_status(uuid[]) IS
'Phase 3 · Step 2. Adds entry-level pending gate via any_photo_pending(): if ANY photo in entry.current_round has no valid judge_decisions row, public_status collapses to judging_in_progress and placement / r4_tags / progression_note are nulled. No fallback to legacy progression_decision read.';
