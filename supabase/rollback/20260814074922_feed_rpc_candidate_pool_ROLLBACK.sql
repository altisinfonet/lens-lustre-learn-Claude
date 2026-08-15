-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260814080000_feed_rpc_candidate_pool.sql
--
-- ⚠ RE-RUNNING 20260813171159 IS NOT A ROLLBACK. Trap #3: that file also uses
-- CREATE FUNCTION after a DROP, so replaying it produces the same
-- "cannot change return type of existing function" this exists to work around.
-- This file is the way back.
--
-- Restores the EXACT definition live before 20260814080000 — the whole-corpus
-- scan with the count(DISTINCT) LATERAL and per-call random(). It is slower by
-- three orders of magnitude at 1M posts (measured: 9,489 ms vs 8 ms) but it is
-- what was running, and a rollback restores the previous state rather than a
-- compromise.
--
-- The columns and helper functions from 20260814070357 are deliberately left in
-- place: nothing here references them, and they are reverted by their own
-- rollback file if that is also wanted. Reverting them from here would couple
-- two migrations that were separated on purpose.
--
-- Grants are restored to exactly what production held: PUBLIC on the two legacy
-- overloads, none on the 4-arg.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.get_broadcast_feed(uuid[], integer, integer, text[]);
DROP FUNCTION IF EXISTS public.get_broadcast_feed(uuid[], integer, integer);
DROP FUNCTION IF EXISTS public.get_broadcast_feed(uuid[], integer);

CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids  uuid[],
  _limit        integer,
  _newest_first integer,
  _categories   text[]
)
RETURNS TABLE(
  id             uuid,
  user_id        uuid,
  content        text,
  image_url      text,
  image_urls     text[],
  privacy        text,
  created_at     timestamp with time zone,
  likes_count    integer,
  comments_count integer,
  shares_count   integer,
  feed_tier text,
  author_name    text,
  author_avatar  text,
  thumbnail_urls text[],
  categories     text[]
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  visible AS (
    SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count
    FROM public.posts p, me
    WHERE public.can_view_post(me.uid, p.user_id, p.privacy)
      AND NOT (p.id = ANY(COALESCE(_exclude_ids, '{}'::uuid[])))
      AND (_categories IS NULL OR p.categories && _categories)
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
  ),
  ranked AS (
    SELECT x.id, x.user_id, x.content, x.image_url, x.image_urls, x.privacy,
           x.created_at, x.likes_count, x.comments_count, x.shares_count,
           x.feed_tier, x.tier_order, x.rn
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
    LIMIT _limit
  )
  SELECT r.id, r.user_id, r.content, r.image_url, r.image_urls, r.privacy,
         r.created_at, r.likes_count, r.comments_count, r.shares_count,
         r.feed_tier,
         ppd.full_name  AS author_name,
         ppd.avatar_url AS author_avatar,
         p.thumbnail_urls,
         p.categories
  FROM ranked r
  LEFT JOIN public.profiles_public_data ppd ON ppd.id = r.user_id
  LEFT JOIN public.posts p                  ON p.id  = r.id
  ORDER BY r.tier_order ASC, r.rn ASC;
$function$;

CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids  uuid[],
  _limit        integer,
  _newest_first integer
)
RETURNS TABLE(
  id             uuid,
  user_id        uuid,
  content        text,
  image_url      text,
  image_urls     text[],
  privacy        text,
  created_at     timestamp with time zone,
  likes_count    integer,
  comments_count integer,
  shares_count   integer,
  feed_tier text,
  author_name    text,
  author_avatar  text,
  thumbnail_urls text[],
  categories     text[]
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, NULL::text[]);
$function$;

CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[],
  _limit       integer
)
RETURNS TABLE(
  id             uuid,
  user_id        uuid,
  content        text,
  image_url      text,
  image_urls     text[],
  privacy        text,
  created_at     timestamp with time zone,
  likes_count    integer,
  comments_count integer,
  shares_count   integer,
  feed_tier text,
  author_name    text,
  author_avatar  text,
  thumbnail_urls text[],
  categories     text[]
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, 0, NULL::text[]);
$function$;

-- Exactly what production held before 20260814080000.
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer)         TO anon, authenticated, service_role, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer)                  TO anon, authenticated, service_role, PUBLIC;
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) FROM PUBLIC;

COMMIT;
