-- ============================================================================
-- AD COMMENTS GET THE TWO POLICIES POST COMMENTS ALREADY HAD.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- 20260811120000_ad_creative_engagement.sql created ad_creative_comments as a
-- deliberate sibling of post_comments and reused everything that was genuinely
-- generic — enforce_comment_blocklist(), account_is_live(), has_role(). Two
-- protections that post_comments carries were not carried across, and both are
-- absences rather than decisions:
--
--   1. A BANNED MEMBER MAY STILL COMMENT ON AN ADVERTISEMENT.
--      post_comments has the RESTRICTIVE policy "Banned users cannot comment on
--      posts" (from 20260325172741). ad_creative_comments has nothing that
--      reads is_banned at all, so banning a member closes the post thread to
--      them and leaves every sponsored ad in the feed open.
--
--   2. THE COMMENTS ON A HIDDEN AD ARE READABLE BY ANY SIGNED-IN MEMBER.
--      post_comments' only SELECT policy is the visibility rule — you may read
--      a comment only if you may see the thing it is on. ad_creative_comments
--      reads `USING (true)`, so switching a creative to Hidden takes the ad out
--      of the feed and off its page (fixed 2026-08-11 in src/pages/AdDetail.tsx)
--      while /rest/v1/ad_creative_comments?creative_id=eq.<id> still serves the
--      thread underneath it to anyone who knows the id.
--
-- Neither is a hole this migration opened; both are gaps between two tables
-- that are supposed to behave the same way.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY BOTH ARE RESTRICTIVE, AND WHY NOTHING IS DROPPED
--
-- Multiple PERMISSIVE policies are OR'd. The existing "Members read ad comments"
-- says `USING (true)`, so a new permissive SELECT policy beside it would change
-- nothing at all — `true OR anything` is true. A RESTRICTIVE policy is AND'ed
-- with the permissive result and can only ever take access away, which is
-- exactly what is wanted and is the shape post_comments' own banned-user policy
-- is stored in (verified against pg_policies, not against the source of
-- 20260325172741, which wrote it before RESTRICTIVE was the house style).
--
-- So this migration is EXPAND-ONLY: it adds two policies and drops nothing.
-- "Members read ad comments" stays exactly as it is; the new restriction
-- narrows what it grants. Nothing here alters a table, a column or a row.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT "MAY SEE THE AD" MEANS
--
-- The ad's own SELECT policy: `ad_creatives_public_read_active USING (is_active)`,
-- plus `ad_creatives_admin_all` for an administrator. The predicate below states
-- that rule rather than leaning on the nested table's RLS to enforce it — the
-- same way post_comments names can_view_post() instead of joining and hoping.
-- An admin keeps reading the thread on a hidden creative, which is what the
-- admin review queue in src/components/admin/AdminCommentReports.tsx needs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS DOES NOT TOUCH
--
-- ad_impressions and everything downstream of it. Ad analytics are a separate
-- path with their own policies and are deliberately out of scope.
--
-- get_ad_engagement(uuid[]) is SECURITY DEFINER and so is unaffected by the new
-- SELECT restriction: the comment COUNT on a creative is computed inside the
-- function and keeps working. That is intended — the count belongs to the ad,
-- and the ad is either visible or it is not.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY
--
--   select policyname, permissive, cmd, qual, with_check
--     from pg_policies
--    where schemaname='public' and tablename='ad_creative_comments'
--    order by cmd, policyname;
--   -- expect 9 rows: the 7 that existed, plus the 2 below.
-- ============================================================================

-- ── 1. A banned member cannot comment on an advertisement ──────────────────
-- The same predicate, the same role and the same strength as post_comments'.
-- `(select auth.uid())` rather than a bare call so the planner treats it as an
-- InitPlan and evaluates it once per statement, matching how the live
-- post_comments policy is stored.
DROP POLICY IF EXISTS "Banned users cannot comment on ads" ON public.ad_creative_comments;
CREATE POLICY "Banned users cannot comment on ads"
  ON public.ad_creative_comments
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_banned((select auth.uid())));

-- ── 2. A comment is readable only if its ad is ─────────────────────────────
-- post_comments' rule, transposed: "you may read a comment on a post you may
-- see" becomes "you may read a comment on an ad you may see".
DROP POLICY IF EXISTS "Ad comments follow the ad's visibility" ON public.ad_creative_comments;
CREATE POLICY "Ad comments follow the ad's visibility"
  ON public.ad_creative_comments
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.ad_creatives c
       WHERE c.id = ad_creative_comments.creative_id
         AND (c.is_active OR public.has_role((select auth.uid()), 'admin'::app_role))
    )
  );

COMMENT ON POLICY "Banned users cannot comment on ads" ON public.ad_creative_comments IS
  'Parity with post_comments "Banned users cannot comment on posts". Without it a ban closes the post threads and leaves every sponsored ad open.';

COMMENT ON POLICY "Ad comments follow the ad's visibility" ON public.ad_creative_comments IS
  'Parity with post_comments "Users can view comments on visible posts". A hidden creative''s thread was readable by any signed-in member straight from PostgREST.';
