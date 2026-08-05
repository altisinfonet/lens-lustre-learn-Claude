-- ============================================================================
-- AN EXPLICIT NULL _exclude_ids EMPTIES THE FEED, SILENTLY.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Found 2026-08-05 while measuring the "feed keeps showing the same posts"
-- report. This is NOT that bug — that one turned out to be client-side caching.
-- This is a separate trap found on the way, and it is worth closing precisely
-- because it fails with no error at all.
--
-- MEASURED ON PRODUCTION, as a real member, with 150 posts in the table:
--
--     get_broadcast_feed(NULL, 10)          ->   0 rows
--     get_broadcast_feed('{}'::uuid[], 10)  ->  10 rows
--
-- One line in the `visible` CTE is the cause:
--
--     AND NOT (p.id = ANY(_exclude_ids))
--
-- With a NULL array, `p.id = ANY(NULL)` is NULL and `NOT NULL` is NULL — which
-- is not TRUE, so the WHERE clause rejects every row. Proven directly on
-- production:  SELECT NOT ('...'::uuid = ANY(NULL::uuid[]))  ->  NULL
--
-- HOW EXPOSED IS IT, honestly:
--   * The parameter already carries `DEFAULT '{}'`, so a caller that OMITS it
--     is fine.
--   * `useFeedQuery.ts` builds the argument as `... ?? []`, so the live app
--     always sends an array. **No member is hitting this today.**
--   * Only an EXPLICIT null reaches it — which is exactly what a future caller
--     writing `_exclude_ids: null`, or a hand-run check, would send.
--
-- WHY FIX IT: the failure mode is an empty feed with a 200 response. The
-- client's `rawPosts.length === 0` branch reads that as "you have reached the
-- end", so the member sees an empty feed and has nothing to report. One
-- COALESCE removes the whole class.
--
-- This is byte-for-byte the deployed function from
-- 20260804090000_feed_reshuffle_on_refresh.sql with that single clause changed
-- — NOT a re-derivation. COALESCE(NULL,'{}') = '{}' and COALESCE(x,'{}') = x,
-- so behaviour for every existing call is identical.
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
      AND NOT (p.id = ANY(COALESCE(_exclude_ids, '{}'::uuid[])))
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
