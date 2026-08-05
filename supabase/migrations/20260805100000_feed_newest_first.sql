-- ============================================================================
-- THE NEWEST POSTS COME FIRST — then maximum visibility for everything else.
--
-- OWNER ORDER, 2026-08-05:
--
--   "Now feed error solved - last post will be seen 1st on refresh only current
--    old post will show and posts, evry pic must be maximum interaction try
--    method. on app and web 1st loading alwasy current pots 1st."
--
-- THIS REVERSES PART OF HIS OWN ORDER OF 2026-08-04, AND THAT IS DELIBERATE —
-- IT IS RECORDED HERE SO NOBODY LATER "FIXES" IT BACK. On 2026-08-04 he said
-- "on every refresh changing is a must, to ensure maximum visibility of all
-- posts, not newer ones", and migration 20260804090000 accordingly removed the
-- recency term from tier 1 completely. The result was correct to that order and
-- wrong in practice: a member who had just posted, or who opened the app to see
-- what was new, could scroll a whole page without meeting a single recent post.
--
-- Both halves of what he wants are satisfiable at once, and that is the design:
--
--   POSITION 1..N  the newest visible posts, strictly by created_at DESC.
--                  "1st loading always current posts 1st."
--   POSITION N+1.. the existing jittered fairness deal, reshuffled on every
--                  request. "Every pic must be maximum interaction."
--
-- N is passed by the caller (_newest_first), NOT inferred from an empty
-- _exclude_ids. Inferring it would have been implicit behaviour: page 2 of a
-- session whose page 1 returned nothing also has an empty exclude list, and the
-- newest posts would silently be pinned twice.
--
-- WHAT IS NOT CHANGED — the guarantees this feed already had
--
--   * VISIBILITY. The visible CTE is untouched and every tier still reads from
--     it, so can_view_post decides who sees what.
--   * NO DUPLICATES. The newest ids are excluded from both fairness tiers, so a
--     post cannot appear twice in one response.
--   * NO REPLAY. Tier 1 keeps viewers + random()*6, tier 2 keeps whole-day
--     buckets shuffled within the day.
--   * DEFAULT IS ZERO. Any caller that does not pass it — including an old app
--     build still running on a member's phone — behaves EXACTLY as before.
--
-- WHY N = 3 AT THE CALL SITE (src/hooks/feed/useFeedQuery.ts): with a 10-post
-- page, three pinned newest posts answer "current posts first" on the opening
-- screen while leaving 7 of the first 10 to the fairness deal.
--
-- VERIFIED ON PRODUCTION, impersonated as a real member:
--   newest@08-05 04:54 | newest@08-04 18:27 | newest@08-04 16:04 | unseen@07-29
--   | unseen@08-01 | unseen@04-07 | unseen@04-19 | unseen@07-31 | ...
--   distinct ids in 10 rows: 10
--
-- ROLLBACK: re-run 20260804090000_feed_reshuffle_on_refresh.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}',
  _limit integer DEFAULT 10,
  _newest_first integer DEFAULT 0
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
  newest AS (
    SELECT v.*, row_number() OVER (ORDER BY v.created_at DESC, v.id) AS rn
    FROM visible v
    ORDER BY v.created_at DESC, v.id
    LIMIT GREATEST(_newest_first, 0)
  ),
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
  seen AS (
    SELECT e.post_id, e.last_seen_at
    FROM my_events e
    WHERE e.views > 0
       OR e.skips >= 2
       OR (e.skips = 1 AND e.last_seen_at > now() - interval '12 hours')
  ),
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
      AND NOT EXISTS (SELECT 1 FROM newest n WHERE n.id = v.id)
  ),
  seen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY floor(extract(epoch FROM (now() - s.last_seen_at)) / 86400.0) DESC,
                      random()
           ) AS rn
    FROM visible v
    JOIN seen s ON s.post_id = v.id
    WHERE NOT EXISTS (SELECT 1 FROM newest n WHERE n.id = v.id)
  )
  SELECT x.id, x.user_id, x.content, x.image_url, x.image_urls, x.privacy,
         x.created_at, x.likes_count, x.comments_count, x.shares_count,
         x.feed_tier
  FROM (
    SELECT n.id, n.user_id, n.content, n.image_url, n.image_urls, n.privacy,
           n.created_at, n.likes_count, n.comments_count, n.shares_count,
           'newest'::text AS feed_tier, 0 AS tier_order, n.rn
    FROM newest n
    UNION ALL
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

GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer) TO authenticated;
