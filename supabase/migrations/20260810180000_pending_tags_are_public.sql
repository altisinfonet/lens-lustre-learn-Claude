-- ============================================================================
-- A TAG IS PUBLIC THE MOMENT IT IS MADE.                        (2026-08-10)
--
-- THE OWNER'S RULING, verbatim, and it is his SECOND answer — he replaced an
-- earlier one within the hour:
--
--   "Show immediately to public, but tagged person only can remove my Tag
--    anytime. This is my updated answer"
--
-- WHAT WAS IN THE WAY
--
--   The post header now says "50mm Retina World with Avijit Sheel". The names
--   are read from public.post_tags, and the only SELECT policy open to third
--   parties was:
--
--     CREATE POLICY "Anyone views approved tags"
--       ON public.post_tags FOR SELECT USING (status = 'approved');
--
--   So a PENDING tag was readable by exactly three people — the tagger, the
--   tagged member, and the post's owner. Every other member's feed returned no
--   row, and the header showed nothing. Measured on production 2026-08-10:
--   the entire table held ONE tag and its status was 'pending', which is why
--   the owner reported the feature as not working.
--
-- WHAT THIS CHANGES — one policy, nothing else
--
--   'pending' joins 'approved' as publicly readable.
--
--   'declined' and 'removed' stay private and are never selected by the client
--   either. Those two are refusals, and the whole point of the accept/decline
--   flow is that a refusal is honoured. This migration must never be "tidied"
--   into `USING (true)`.
--
-- WHY THIS IS SAFE TO DO, AND WHAT HAD TO EXIST FIRST
--
--   Publishing a pending tag on its own would have been harmful. Anyone may tag
--   anyone (shipped earlier the same day), so a member could have found their
--   name on a stranger's photograph with no way to take it off: Accept/Decline
--   lived only on the bell notification, only while the row was still 'pending',
--   and only until that notification was dismissed.
--
--   So the owner's OTHER half — "tagged person only can remove my Tag anytime" —
--   ships in the same change, as a "Remove tag of me" item in the post menu,
--   visible to a tagged member on any post at any time.
--
--   The database already permitted exactly that and NOTHING here loosens it:
--
--     * "Tagged user updates tag status" is
--         FOR UPDATE USING (auth.uid() = tagged_user_id)
--       with NO condition on status — so a tag can be removed after it was
--       approved, not just while pending.
--     * validate_post_tag_update() raises unless auth.uid() = OLD.tagged_user_id,
--       and raises if any column other than status / responded_at changes.
--
--   Neither is touched. A member can still only ever remove their OWN tag.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * The three narrower SELECT policies (tagger, tagged user, post owner) stay
--     as they are. They cover 'declined' and 'removed' for the people entitled
--     to see them, and dropping them would hide a member's own refused tags
--     from them.
--   * validate_post_tag_insert(), the notification trigger, the decline guard
--     and the 20-tag cap are untouched.
--
-- ROLLBACK — one statement, restores the old behaviour exactly:
--   DROP POLICY IF EXISTS "Anyone views approved tags" ON public.post_tags;
--   CREATE POLICY "Anyone views approved tags"
--     ON public.post_tags FOR SELECT USING (status = 'approved');
--   The client is inert without it: with only approved rows readable, the
--   header falls back to showing accepted tags only.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone views approved tags" ON public.post_tags;

CREATE POLICY "Anyone views approved tags"
  ON public.post_tags FOR SELECT
  -- 'pending' is public because the owner asked for it; 'declined' and
  -- 'removed' are refusals and stay out. Do not widen this to `true`.
  USING (status IN ('approved', 'pending'));

COMMENT ON TABLE public.post_tags IS
  'People tagged in a post. status pending|approved are publicly readable and both render as "with <name>" on the post header (owner ruling 2026-08-10, "show immediately to public"); declined|removed are visible only to the tagger, the tagged member and the post owner, and are never rendered. The tagged member may set status to removed at ANY time from the post menu - "tagged person only can remove my Tag anytime" - which is what makes publishing a pending tag safe.';
