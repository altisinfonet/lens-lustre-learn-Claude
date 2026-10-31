
-- Phase 7 — Judging Phase Engagement Privacy (server-side gate)
-- Scope: competition_votes, image_reactions, image_comments
-- Rule: engagement counts on competition entries are readable ONLY when the
--   entry's competition is NOT in 'voting' or 'judging' phase.
-- Bypass: entry owner (own entry), admins.
-- Non-competition images (portfolio/post) are unaffected.

-- Helper: is this image row in a phase-locked competition?
-- Returns TRUE only when image_type = 'competition_entry' AND phase IN ('voting','judging').
CREATE OR REPLACE FUNCTION public.is_engagement_phase_locked(
  _image_type text,
  _image_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _image_type <> 'competition_entry' THEN false
    ELSE COALESCE((
      SELECT c.phase IN ('voting','judging')
      FROM competition_entries ce
      JOIN competitions c ON c.id = ce.competition_id
      WHERE ce.id = _image_id
    ), false)
  END
$$;

COMMENT ON FUNCTION public.is_engagement_phase_locked(text, uuid)
IS 'Phase 7: returns TRUE when the given image belongs to a competition entry whose competition is in voting or judging phase. Used by SELECT RLS on image_reactions / image_comments to hide engagement counts during those phases.';

-- Helper: is this competition_votes row in a phase-locked competition?
CREATE OR REPLACE FUNCTION public.is_vote_phase_locked(_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT c.phase = 'judging'
    FROM competition_entries ce
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
  ), false)
$$;

COMMENT ON FUNCTION public.is_vote_phase_locked(uuid)
IS 'Phase 7: returns TRUE when the entry belongs to a competition in judging phase. competition_votes SELECT is denied to non-owner non-admin viewers during judging (voting-phase votes are still visible since users need their own vote status; SOW hides counts via UI during voting but keeps write access).';

-- Helper: does the current user own the entry (for bypass)?
CREATE OR REPLACE FUNCTION public.is_entry_owner(_entry_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM competition_entries WHERE id = _entry_id AND user_id = _user_id
  )
$$;

-- ============================================================
-- image_reactions: replace permissive SELECT with phase gate
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view reactions" ON public.image_reactions;

CREATE POLICY "View reactions (phase-gated)"
ON public.image_reactions
FOR SELECT
TO public
USING (
  NOT is_engagement_phase_locked(image_type, image_id)
  OR (auth.uid() IS NOT NULL AND is_entry_owner(image_id, auth.uid()))
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- ============================================================
-- image_comments: replace permissive SELECT with phase gate
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view non-flagged comments" ON public.image_comments;

CREATE POLICY "View non-flagged comments (phase-gated)"
ON public.image_comments
FOR SELECT
TO public
USING (
  ((is_flagged = false) OR (user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
  AND (
    NOT is_engagement_phase_locked(image_type, image_id)
    OR user_id = auth.uid()
    OR (auth.uid() IS NOT NULL AND is_entry_owner(image_id, auth.uid()))
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

-- ============================================================
-- competition_votes: gate SELECT during judging phase
--   Voting phase keeps vote rows visible so users can see their own
--   vote state; UI hides counts. Judging phase fully hides rows.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view vote counts" ON public.competition_votes;

CREATE POLICY "View vote counts (phase-gated)"
ON public.competition_votes
FOR SELECT
TO authenticated
USING (
  NOT is_vote_phase_locked(entry_id)
  OR user_id = auth.uid()
  OR is_entry_owner(entry_id, auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
);
