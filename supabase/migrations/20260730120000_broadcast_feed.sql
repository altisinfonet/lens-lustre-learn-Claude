-- ============================================================================
-- BROADCAST + NEVER-REPEAT FEED (owner-approved spec, 2026-07-30)
--
--   1. Every visible post is eligible — no time window, no pool cap.
--      Visibility = existing can_view_post(): public → everyone,
--      friends-only → friends, own posts → always. Privacy unchanged.
--   2. Posts the requester has already seen (feed_events view/skip) are
--      excluded first — "one pic won't repeat".
--   3. Fairness: among unseen posts, fewest distinct viewers first,
--      then newest first — equalizes exposure per photo.
--   4. Fallback when unseen runs out: seen posts, least-recently-seen
--      first (recycling) — the feed never runs dry.
--   5. "No same author back-to-back" is applied client-side.
--      The existing 30 posts/hour rate limit is unchanged.
--
-- This migration ONLY adds two indexes and one new function.
-- It does not modify or drop anything that exists.
-- ============================================================================

-- Index for per-post impression counting (feed_events had no post_id index)
CREATE INDEX IF NOT EXISTS idx_feed_events_post
  ON public.feed_events (post_id);

-- Index for the requester's own seen-check
CREATE INDEX IF NOT EXISTS idx_feed_events_user_post
  ON public.feed_events (user_id, post_id);

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
  -- Every post the requester is allowed to see, minus posts already
  -- delivered in this scroll session (_exclude_ids).
  visible AS (
    SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count
    FROM public.posts p, me
    WHERE public.can_view_post(me.uid, p.user_id, p.privacy)
      AND NOT (p.id = ANY(_exclude_ids))
  ),
  -- Posts the requester has personally seen (view or skip impression).
  seen AS (
    SELECT fe.post_id, max(fe.created_at) AS last_seen_at
    FROM public.feed_events fe, me
    WHERE fe.user_id = me.uid
      AND fe.event_type IN ('view', 'skip')
    GROUP BY fe.post_id
  ),
  -- TIER 1: unseen posts, fewest distinct viewers first, then newest first.
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
  -- TIER 2: already-seen posts, least-recently-seen first (recycling).
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
