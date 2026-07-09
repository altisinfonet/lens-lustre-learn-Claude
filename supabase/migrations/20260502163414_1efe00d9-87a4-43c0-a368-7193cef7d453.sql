-- Forensic fix: remove obsolete per-tag entry aggregation trigger.
-- Root cause: on the final photo, trg_aggregate_tag_assignments called
-- recompute_entry_from_tag_assignments(), which attempted to set
-- competition_entries.progression_decision during live per-photo judging.
-- That violates the current admin-gated round declaration architecture and
-- collides with enforce_progression_decision_pending_gate(), producing:
-- "progression_decision cannot be set ... any_photo_pending = TRUE".
--
-- Keep both mirror triggers untouched here because they are the path that
-- mirrors judge_tag_assignments -> judge_decisions.
DROP TRIGGER IF EXISTS trg_aggregate_tag_assignments ON public.judge_tag_assignments;

-- Safety hardening: make the obsolete function a no-op if anything still calls it.
-- Entry-level progression is handled by complete-round / publish-round flows,
-- not live tag clicks.
CREATE OR REPLACE FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.recompute_entry_from_tag_assignments(uuid)
IS 'Deprecated/no-op. Per-photo judge_tag_assignments are mirrored to judge_decisions; entry-level progression is admin-gated via round completion/declaration, not live tag-click aggregation.';