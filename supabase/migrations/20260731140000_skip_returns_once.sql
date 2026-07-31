-- ============================================================================
-- FEED: a fast scroll-past no longer burns a photo (owner-approved 2026-07-31)
--
-- PROBLEM
--   The feed retired a photo from someone's fresh feed on EITHER a 'view'
--   (>=2s on screen) OR a 'skip' (0.5-2s). A 1.5-second thumb flick therefore
--   destroyed that photo's only chance with that person, even though they never
--   really looked at it. With a small catalogue this burns through the whole
--   library fast and most photos never get real attention.
--
-- NEW RULE (exact, bounded, invisible to users -- no badges, no dividers)
--   * a genuine 'view'      -> retired permanently
--   * the FIRST 'skip'      -> photo may return ONCE, but not for 12 hours
--                              (so it never reappears on the next refresh)
--   * a SECOND 'skip'       -> retired permanently (they clearly aren't
--                              interested; stop showing it)
--
-- Only the `seen` CTE changes. Signature, returned columns, tier order and
-- fairness ordering are IDENTICAL, so web and app pick this up with no deploy
-- and no new build.
--
-- ROLLBACK: re-run migration 20260730120000_broadcast_feed.sql, which restores
-- the previous definition of this same function.
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
STABLE
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
  -- rule above.
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
  -- TIER 1: still-fresh posts, fewest distinct viewers first, then newest.
  unseen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY COALESCE(imp.viewers, 0) ASC, v.created_at DESC, v.id
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
  -- TIER 2: retired posts, least-recently-seen first, so the feed never ends.
  seen_ranked AS (
    SELECT v.*,
           row_number() OVER (ORDER BY s.last_seen_at ASC, v.id) AS rn
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
