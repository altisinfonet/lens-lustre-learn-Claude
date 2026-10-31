-- ============================================================================
-- FEED: every refresh deals a DIFFERENT arrangement (owner order, 2026-08-04)
--
-- OWNER REPORT
--   "On refresh of feed, don't stick showing same post … a bit older or new
--    post must show, like Instagram and FB. On every refresh changing is a
--    must, to ensure maximum visibility of all posts, not newer ones."
--
-- WHY IT WAS STICKING — measured in the definition below, not guessed
--   The ordering was fully deterministic:
--     tier 1 (unseen):   viewers ASC, created_at DESC, id
--     tier 2 (recycled): last_seen_at ASC, id
--   Same member + same data  ->  byte-identical page 1, every single refresh.
--   A 'view' only registers after >=2s on screen, so refreshing without
--   dwelling retires nothing and the same first screen came back forever.
--
-- THE CHANGE — jittered fairness, nothing else
--   * tier 1: ORDER BY viewers + random()*6  — each request adds 0–6 phantom
--     viewers per post. Under-seen posts still surface first ON AVERAGE (the
--     owner's maximum-visibility rule is kept; there is deliberately NO
--     recency term any more — "not newer ones"), but every refresh shuffles
--     the arrangement, mixing older and newer posts exactly like the big
--     feeds do. The constant 6 is sized against today's real viewer spread
--     (81 members, max distinct viewers per post in single digits); revisit
--     if typical viewer counts grow past ~20.
--   * tier 2: group by WHOLE DAYS since last seen (oldest-seen days first,
--     so nothing you saw five minutes ago outranks last week's), shuffle
--     randomly within each day bucket.
--
-- WHY THIS IS SAFE WITH PAGINATION
--   The client paginates by EXCLUSION (_exclude_ids of everything already
--   delivered this session), not by offset — so per-request randomness can
--   never duplicate a post within a scroll session, and the client's
--   flattenFeedPages() additionally dedupes by id across refetched pages.
--
-- STABLE -> VOLATILE because random() is volatile; the function is called
-- once per page, so the lost optimisation is irrelevant.
--
-- Signature, returned columns, visibility rules, the seen/skip retirement
-- rules and the tier structure are IDENTICAL. Web and app pick this up with
-- no deploy and no new build.
--
-- ROLLBACK: re-run migration 20260731140000_skip_returns_once.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}',
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  content text,
  image_url text,
  image_urls text[],
  privacy text,
  created_at timestamptz,
  likes_count integer,
  comments_count integer,
  shares_count integer,
  feed_tier text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  visible AS (
    SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count
    FROM public.posts p, me
    WHERE public.can_view_post(me.uid, p.user_id, p.privacy)
      AND NOT (p.id = ANY(_exclude_ids))
  ),
  -- Everything this person has looked at, with the counts needed to apply the
  -- skip/view retirement rule (unchanged since 20260731140000).
  my_events AS (
    SELECT fe.post_id,
           count(*) FILTER (WHERE fe.event_type = 'view') AS views,
           count(*) FILTER (WHERE fe.event_type = 'skip') AS skips,
           max(fe.created_at)                             AS last_seen_at
    FROM public.feed_events fe, me
    WHERE fe.user_id = me.uid
      AND fe.event_type IN ('view', 'skip')
    GROUP BY fe.post_id
  ),
  -- RETIRED = genuinely viewed, or skipped twice, or skipped once within the
  -- last 12 hours (the cooldown that stops it bouncing back on a refresh).
  seen AS (
    SELECT e.post_id, e.last_seen_at
    FROM my_events e
    WHERE e.views > 0
       OR e.skips >= 2
       OR (e.skips = 1 AND e.last_seen_at > now() - interval '12 hours')
  ),
  -- TIER 1: still-fresh posts — jittered fairness. Fewest real viewers first
  -- ON AVERAGE, freshly shuffled on every request. No recency term: the owner
  -- wants maximum visibility of ALL posts, not the newest.
  unseen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY COALESCE(imp.viewers, 0) + random() * 6.0 ASC
           ) AS rn
    FROM visible v
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT fe.user_id) AS viewers
      FROM public.feed_events fe
      WHERE fe.post_id = v.id
        AND fe.event_type IN ('view', 'skip')
    ) imp ON true
    WHERE NOT EXISTS (SELECT 1 FROM seen s WHERE s.post_id = v.id)
  ),
  -- TIER 2: retired posts — oldest-seen DAY first, shuffled within each day,
  -- so the feed never ends and never replays in one fixed order.
  seen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY floor(extract(epoch FROM (now() - s.last_seen_at)) / 86400.0) DESC,
                      random()
           ) AS rn
    FROM visible v
    JOIN seen s ON s.post_id = v.id
  )
  SELECT x.id, x.user_id, x.content, x.image_url, x.image_urls, x.privacy,
         x.created_at, x.likes_count, x.comments_count, x.shares_count,
         x.feed_tier
  FROM (
    SELECT u.id, u.user_id, u.content, u.image_url, u.image_urls, u.privacy,
           u.created_at, u.likes_count, u.comments_count, u.shares_count,
           'unseen'::text AS feed_tier, 1 AS tier_order, u.rn
    FROM unseen_ranked u
    WHERE u.rn <= _limit
    UNION ALL
    SELECT s.id, s.user_id, s.content, s.image_url, s.image_urls, s.privacy,
           s.created_at, s.likes_count, s.comments_count, s.shares_count,
           'recycled'::text AS feed_tier, 2 AS tier_order, s.rn
    FROM seen_ranked s
    WHERE s.rn <= _limit
  ) x
  ORDER BY x.tier_order ASC, x.rn ASC
  LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer) TO authenticated;
