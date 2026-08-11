-- Top Contributors V2 — Contributor Score calculated live from current data.
--
-- =============================================================================
-- WHY THIS EXISTS
--
-- Owner, 2026-08-11: Top Contributors must recognise members for what they
-- contribute — photographs posted and comments WRITTEN — over a rolling 30 UTC
-- days, and every member carries a public "Contributor Score" under their name.
--
-- The existing get_top_contributors_v1 does something different. It ranks by
-- comments RECEIVED on your own photographs, so a member who comments
-- generously on everyone else's work scores nothing. It also starts FROM posts,
-- so a member with no posts cannot appear at all however much they engage.
--
-- v1 IS NOT TOUCHED BY THIS MIGRATION. It stays exactly as it is so the Home
-- page keeps working and rollback is a one-line frontend revert. Nothing a
-- member can see changes when this runs.
--
-- =============================================================================
-- NO LEDGER, NO CACHE, NO JOBS — AND WHY THAT IS THE RIGHT CALL HERE
--
-- Owner, 2026-08-11: "The current database state is the source of truth...
-- There is NO permanent score ledger... Do not build infrastructure before the
-- platform needs it."
--
-- The whole platform holds 193 posts and 162 comments. Counting them from
-- scratch costs less than fetching a cached answer would. Computing live also
-- makes three hard requirements free rather than expensive:
--
--   * a deleted post stops counting because it is not there — no trigger,
--     no recompute job, no decrement logic;
--   * a deleted PROFILE vanishes from the leaderboard on the very next query,
--     because the eligibility filter joins profiles — nothing to refresh,
--     nothing that can be forgotten;
--   * the rolling 30-day window moves on its own — it is a WHERE clause, not
--     a stored value, so no scheduled job is needed to advance it.
--
-- When the platform is large enough that this is measurably slow, the fix is a
-- daily-metrics cache behind these same function signatures. Not before.
--
-- =============================================================================
-- CASCADE DELETION — A KNOWN, ACCEPTED LIMITATION
--
-- post_comments.post_id REFERENCES posts(id) ON DELETE CASCADE, so deleting a
-- photograph destroys the comments other members wrote on it, and those members
-- lose that credit. Preserving it would need a capture table and a BEFORE DELETE
-- trigger. Owner decided 2026-08-11 that Phase 1 accepts this: "If it no longer
-- exists in the authoritative data, it does not contribute."
--
-- =============================================================================
-- WHAT PHASE 1 DELIBERATELY OMITS
--
-- Active Engagement is 20% of the final score and contributes 0 here, because
-- no engagement data exists and none may be fabricated from last_active_at,
-- activity_logs or feed_events (all three were audited and rejected — see
-- claude/CONTRIBUTOR_AUDIT_2026-08-11.md). The unused 20% is NOT redistributed,
-- so when the Phase 2 collector ships the weights need no adjustment and no
-- score already earned changes. A perfect Phase 1 day is 2400 of a possible 3000.

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEX
--
-- Every existing index on post_comments is keyed by post_id or parent_id,
-- because until now comments were only ever read FOR A POST. Counting comments
-- WRITTEN BY A MEMBER had nothing to use. At 162 rows this changes no plan
-- today; it is required before the table grows.
CREATE INDEX IF NOT EXISTS idx_post_comments_user_created
  ON public.post_comments (user_id, created_at);

-- image_comments deliberately gets no index: it holds 0 rows. Add one when it
-- holds data, not before.


-- ─────────────────────────────────────────────────────────────────────────────
-- THE FORMULA AND THE ELIGIBILITY RULE — DEFINED EXACTLY ONCE
--
-- Both public functions call this. Kept in one place so the leaderboard and the
-- badge can never disagree: a change to the maths or to who is eligible is a
-- change to both, always.
--
-- _since NULL  -> lifetime
-- _since date  -> only UTC days on or after that date
--
-- TIERS (diminishing returns, so flooding cannot dominate)
--   posts    1-3 = 10 each, 4-6 = 5 each, 7-10 = 2 each, 11+ = 0   -> max 53/day
--   comments 1-5 = 4 each, 6-15 = 2 each, 16-30 = 1 each, 31+ = 0  -> max 55/day
--
-- WEIGHTS  posts 45%, comments 35%, engagement 0% (Phase 1)
--   daily_score = 3 * (450 * post_points/53 + 350 * comment_points/55)
--   The leading 3 is the display scale — it changes no ranking and no
--   proportion, only how large the number reads.
--
-- NOTE ON UNITS: post_points/comment_points are the values AFTER the tier
-- ladder, never the raw counts. One post is 10 points, not 1.
CREATE OR REPLACE FUNCTION public.contributor_points_since(_since date)
RETURNS TABLE (uid uuid, score numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH eligible AS (
    -- ACCOUNT ELIGIBILITY. Owner, 2026-08-11: "Only the admin role is excluded
    -- by account role. Do NOT automatically exclude judge, content_editor,
    -- registered_photographer, student, normal user."
    --
    -- The profiles row is what makes a deleted account disappear instantly:
    -- no profile, no score, no ranking, on the very next call. Note that
    -- deleting an account does NOT delete its posts (posts.user_id has no
    -- foreign key to auth.users, which is why admin_purge_orphan_user_data
    -- exists), so this join is doing real work, not decoration.
    SELECT pr.id
    FROM public.profiles pr
    WHERE COALESCE(pr.is_suspended, false) = false
      AND COALESCE(pr.is_banned, false) = false
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pr.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = pr.id
          AND ur.role::text = 'admin'
      )
  ),
  post_days AS (
    -- Public photographs only. Private and friends-only earn nothing.
    SELECT p.user_id AS u,
           (p.created_at AT TIME ZONE 'UTC')::date AS d,
           COUNT(*) AS n
    FROM public.posts p
    JOIN eligible e ON e.id = p.user_id
    WHERE p.privacy = 'public'
      AND (_since IS NULL OR (p.created_at AT TIME ZONE 'UTC')::date >= _since)
    GROUP BY 1, 2
  ),
  comment_days AS (
    -- Comments the member WROTE. Comments received on their photographs are
    -- not here at all — that is the whole difference from v1.
    -- Ad comments are excluded by construction: they live in
    -- ad_creative_comments, which is not read by this function.
    SELECT c.u, c.d, COUNT(*) AS n
    FROM (
      SELECT pc.user_id AS u, (pc.created_at AT TIME ZONE 'UTC')::date AS d
      FROM public.post_comments pc
      JOIN eligible e ON e.id = pc.user_id
      WHERE (_since IS NULL OR (pc.created_at AT TIME ZONE 'UTC')::date >= _since)
      UNION ALL
      SELECT ic.user_id AS u, (ic.created_at AT TIME ZONE 'UTC')::date AS d
      FROM public.image_comments ic
      JOIN eligible e ON e.id = ic.user_id
      WHERE ic.is_flagged = false
        AND (_since IS NULL OR (ic.created_at AT TIME ZONE 'UTC')::date >= _since)
    ) c
    GROUP BY 1, 2
  ),
  post_pts AS (
    SELECT pd.u, pd.d,
           LEAST(pd.n, 3) * 10
         + GREATEST(LEAST(pd.n, 6)  - 3, 0) * 5
         + GREATEST(LEAST(pd.n, 10) - 6, 0) * 2 AS pts
    FROM post_days pd
  ),
  comment_pts AS (
    SELECT cd.u, cd.d,
           LEAST(cd.n, 5) * 4
         + GREATEST(LEAST(cd.n, 15) - 5,  0) * 2
         + GREATEST(LEAST(cd.n, 30) - 15, 0) * 1 AS pts
    FROM comment_days cd
  ),
  day_scores AS (
    -- FULL OUTER JOIN of two aggregates, never of raw rows. This is the
    -- deliberate difference from v1, which joins posts against reactions AND
    -- comments in one query: a post with 10 reactions and 8 comments produces
    -- 80 intermediate rows there. Here each side is already one row per
    -- (member, day) before they meet, so nothing multiplies.
    SELECT COALESCE(pp.u, cp.u) AS u,
           COALESCE(pp.pts, 0)  AS ppts,
           COALESCE(cp.pts, 0)  AS cpts
    FROM post_pts pp
    FULL OUTER JOIN comment_pts cp
      ON cp.u = pp.u AND cp.d = pp.d
  )
  SELECT ds.u,
         SUM(3 * (450 * ds.ppts / 53.0 + 350 * ds.cpts / 55.0))
  FROM day_scores ds
  GROUP BY ds.u;
$fn$;

COMMENT ON FUNCTION public.contributor_points_since(date) IS
  'Contributor points per member from live data. _since NULL = lifetime, otherwise from that UTC date. Excludes the admin role, suspended, banned and deleted accounts. Not callable directly - EXECUTE is revoked from everyone so the scores of all members cannot be enumerated; the two public wrappers reach it as SECURITY DEFINER.';


-- ─────────────────────────────────────────────────────────────────────────────
-- HOME PAGE TOP 3
--
-- RANKED by the rolling last 30 UTC days. DISPLAYS the lifetime Contributor
-- Score. Owner, 2026-08-11: "Top Contributor ranking = recent 30-day activity,
-- while Contributor Score displayed under name = current lifetime contribution."
--
-- The 30-day number is NEVER returned, so it cannot reach the UI by accident.
-- Neither are any counts, minutes, or formula internals: "The ranking should
-- feel like recognition, not a 'time spent on app' competition."
CREATE OR REPLACE FUNCTION public.get_top_contributors_v2()
RETURNS TABLE (user_id uuid, rank_position integer, contributor_score integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH recent AS (
    SELECT r.uid, r.score
    FROM public.contributor_points_since(
      ((now() AT TIME ZONE 'UTC')::date - 29)
    ) r
    WHERE r.score > 0
  ),
  lifetime AS (
    SELECT l.uid, l.score FROM public.contributor_points_since(NULL::date) l
  ),
  ranked AS (
    -- uid is the tie-break so the order is stable between calls rather than
    -- shuffling two equal scores on every refresh.
    SELECT rc.uid,
           ROW_NUMBER() OVER (ORDER BY rc.score DESC, rc.uid) AS pos
    FROM recent rc
  )
  SELECT rk.uid,
         rk.pos::integer,
         ROUND(COALESCE(lf.score, 0))::integer
  FROM ranked rk
  LEFT JOIN lifetime lf ON lf.uid = rk.uid
  WHERE rk.pos <= 3
  ORDER BY rk.pos;
$fn$;

COMMENT ON FUNCTION public.get_top_contributors_v2() IS
  'Home page Top Contributors. Ranked by rolling last 30 UTC days, returns the lifetime Contributor Score for display. Never returns the 30-day score, counts or engagement. Replaces get_top_contributors_v1, which is left in place for rollback.';


-- ─────────────────────────────────────────────────────────────────────────────
-- THE SCORE UNDER A MEMBER'S NAME
--
-- Batched by uuid[] so a feed rendering twenty cards makes ONE request rather
-- than twenty. This is not hypothetical caution: the ad engagement bar shipped
-- on 2026-08-11 with a batching promise its callers never honoured, and had to
-- be fixed the same day. src/lib/ads/adEngagement.ts carries the coalescing
-- pattern that fixed it and the client for this will reuse it.
--
-- A member scoring zero returns NO ROW, so the UI shows no badge rather than a
-- bare "0" beside someone else's four-figure score.
--
-- Admin accounts return no row either. Owner, 2026-08-11: "Do NOT return an
-- Admin's Contributor Score from get_contributor_scores(). Underlying
-- posts/comments may still exist in the database, but administrative accounts
-- are not part of the public contributor system." That exclusion lives in
-- contributor_points_since, so both functions enforce it identically.
CREATE OR REPLACE FUNCTION public.get_contributor_scores(_user_ids uuid[])
RETURNS TABLE (user_id uuid, contributor_score integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT c.uid, ROUND(c.score)::integer
  FROM public.contributor_points_since(NULL::date) c
  WHERE c.uid = ANY(_user_ids)
    AND c.score > 0;
$fn$;

COMMENT ON FUNCTION public.get_contributor_scores(uuid[]) IS
  'Public Contributor Score for a batch of members. Returns no row for admin accounts, for suspended, banned or deleted accounts, and for a score of zero.';


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so the helper must be
-- revoked explicitly: it takes an arbitrary date and returns every member's
-- score, which is not something to leave callable. The two wrappers are
-- SECURITY DEFINER, so they reach it regardless.
REVOKE ALL ON FUNCTION public.contributor_points_since(date) FROM public, anon, authenticated;

-- The Home page is public and get_top_contributors_v1 is already anon-executable,
-- so v2 matches it. This is also exactly why v2 returns nothing but a user id, a
-- position and one number.
GRANT EXECUTE ON FUNCTION public.get_top_contributors_v2() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_contributor_scores(uuid[]) TO anon, authenticated;
