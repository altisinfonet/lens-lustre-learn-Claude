-- ============================================================================
-- TODAY'S BIRTHDAY — one source of truth, no row limit, privacy respected.
--
-- THE BUG THIS FIXES (measured on production, 2026-08-04)
--
-- `dashboard-init` built the sidebar's birthday list in TypeScript from this
-- query:
--
--     admin.from("profiles")
--          .select("id, full_name, avatar_url, created_at, date_of_birth")
--          .eq("is_suspended", false)
--          .limit(50)          -- ← no ORDER BY either
--
-- The site has **82 members, 68 with a date of birth recorded, and 28 of those
-- 68 fall outside that 50-row window.** Their birthday could never appear, on
-- any day — including SOMNATH PAL (20 Aug), the next one due. The rows come
-- back in physical heap order (verified: `EXPLAIN` shows `Seq Scan`, and three
-- consecutive runs returned an identical set), so it is consistent — and it
-- silently reshuffles the day anyone's profile row is updated.
--
-- SECOND FAULT, fixed in the same function because fixing the first one makes
-- it worse: the TypeScript never read `privacy_settings`. Edit Profile offers
-- "Control who can see your birthday — day/month and year separately", stored
-- as `privacy_settings->>'dob_day_month'`, and **the UI defaults that control
-- to "friends"**. On production: 1 member chose `public`, 16 chose `friends`,
-- 2 chose `only_me`, and 49 never touched it (so the app has been telling them
-- "Friends"). Lifting the 50-row cap alone would have newly exposed 9 members
-- who had explicitly restricted it. Owner decision, 2026-08-04: respect it.
--
-- WHY AN RPC RATHER THAN A WIDER `select()`
--
-- The friendship test cannot be expressed in a PostgREST filter, and per
-- WORKING_RULES §14 a rule the caller has to remember is not a rule. Putting
-- the whole thing here means every future surface that wants "today's
-- birthdays" gets the privacy rule for free and cannot get it wrong.
--
-- WHAT IS DELIBERATELY UNCHANGED
--
--   * The day boundary is still the server's UTC clock, exactly as the
--     TypeScript computed it (`now.getMonth()/getDate()`), so this fix does not
--     silently move when a birthday starts. For an India-centred community that
--     means the card turns over at 05:30 IST. Recorded as an open decision, not
--     changed unasked.
--   * Milestones and people-suggestions still read the old 50-row query. They
--     have the same weakness; the owner scoped this change to birthdays only.
--
-- 29 FEBRUARY: a member born on 29 Feb matches only in a leap year. No member
-- on production has that date today, so no untested special case is invented
-- here. Recorded as a known edge case.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_todays_birthdays(_viewer uuid)
RETURNS TABLE (id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.is_suspended = false
    AND p.date_of_birth IS NOT NULL
    AND to_char(p.date_of_birth, 'MM-DD') = to_char(now(), 'MM-DD')
    AND (
      -- You always see your own.
      p.id = _viewer
      -- Explicitly public.
      OR COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') = 'public'
      -- Friends-only (and the DEFAULT, because that is what Edit Profile shows
      -- a member who has never touched the control).
      OR (
        COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.requester_id = _viewer AND f.addressee_id = p.id)
              OR (f.addressee_id = _viewer AND f.requester_id = p.id)
            )
        )
      )
      -- 'only_me' falls through to nothing, which is the point.
    )
  ORDER BY p.full_name NULLS LAST;
$$;

COMMENT ON FUNCTION public.get_todays_birthdays(uuid) IS
  'Members whose birthday is today, filtered by their own privacy_settings->>''dob_day_month'' (default: friends). No row limit — replaces a LIMIT 50 in dashboard-init that hid 28 of 68 members.';

-- Anonymous callers must never receive PII-derived data; dashboard-init already
-- returns an empty array for them, and this keeps that true at the DB edge too.
REVOKE ALL ON FUNCTION public.get_todays_birthdays(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_todays_birthdays(uuid) TO service_role;
