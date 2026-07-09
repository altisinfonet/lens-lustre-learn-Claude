-- F-04 enforcement: table-level SELECT overrides column REVOKE in Postgres.
-- Revoke table SELECT then re-grant only the non-sensitive columns.

REVOKE SELECT ON public.competition_entries FROM authenticated;
REVOKE SELECT ON public.competition_entries FROM anon;

GRANT SELECT (
  id, competition_id, user_id, title, description, photos, status,
  created_at, updated_at, placement, is_pinned, view_count, is_trending,
  is_ai_generated, current_round, certificate_ready, photo_thumbnails,
  photo_meta, is_ai_advisory, progression_decision, stage_key,
  public_status_derived, public_round_derived, public_placement_derived,
  public_progression_note_derived, public_r4_tags_derived, current_round_int
) ON public.competition_entries TO authenticated;

-- anon has no RLS policy allowing SELECT today; keep no column grant.
-- service_role retains ALL by default (unchanged).