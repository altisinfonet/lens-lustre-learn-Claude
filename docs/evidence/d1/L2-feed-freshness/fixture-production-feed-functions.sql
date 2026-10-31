-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE (evidence only — never applied to a lane). Production's feed functions,
-- VERBATIM as pg_get_functiondef() printed them on 2026-10-13 (read-only
-- collector, production project). Staging's bodies are identical (md5 equal,
-- read 2026-10-13). pglite-l2-feed.mjs loads this file as the "before" state and
-- re-checks every md5 below:
--   3ae7718671ed2245f34c01c141164d80  feed_rank_score(_id uuid, _bucket integer, _seed text)  acl {postgres=X/postgres,service_role=X/postgres}
--   288ea6c01b82d1c5ab7f541de3fa3f46  feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)  acl {postgres=X/postgres,service_role=X/postgres}
--   96a65d7037ecc5351da75a28f8cace73  get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])  acl {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   59cebfbcfd89f6ad49e46399ee6fe4e2  get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)  acl {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   6ff8f8ea3d8c8cf76e9abe0bd728915e  get_broadcast_feed(_exclude_ids uuid[], _limit integer)  acl {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   5d9c4f1b68ea966c108a03df280e6493  get_post_view_counts(_post_ids uuid[])  acl {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--     (production stores this body with CRLF line endings, md5 5cc40b18605e6188f8b84b8e4e5c1fd1;
--      this file has LF, which is staging's md5 above — the ONLY difference between the lanes)
--   d016b6751eeccada90710b340734310d  rate_limit_feed_events()  acl {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   40248e5e28219b1e7a1cbb269cabe5d0  tg_feed_events_viewer_count()  acl {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   641671d304347bd0ee29c87f44cc3e53  validate_feed_event_author()  acl {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- (each md5 is re-checked against the function the harness created.)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.feed_rank_score(_id uuid, _bucket integer, _seed text)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT _bucket + (hashtextextended(_id::text || _seed, 0) & 2147483647)::float8
                   / 2147483647.0 * 6.0;
$function$;

CREATE OR REPLACE FUNCTION public.feed_candidates(_seed text, _categories text[] DEFAULT NULL::text[], _recent integer DEFAULT 500, _sample integer DEFAULT 1000, _own integer DEFAULT 100, _friends integer DEFAULT 200)
 RETURNS TABLE(id uuid, user_id uuid, created_at timestamp with time zone, bucket integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid)
  (SELECT p.id, p.user_id, p.created_at, p.viewer_bucket_stable
     FROM public.posts p
    WHERE p.is_public AND (_categories IS NULL OR p.categories && _categories)
    ORDER BY p.created_at DESC LIMIT _recent)
  UNION
  (SELECT p.id, p.user_id, p.created_at, p.viewer_bucket_stable
     FROM public.posts p
    WHERE p.is_public AND (_categories IS NULL OR p.categories && _categories)
      AND p.rand_key >= (hashtextextended(_seed, 0) & 2147483647)::float8 / 2147483647.0
    ORDER BY p.rand_key LIMIT _sample)
  UNION
  (SELECT p.id, p.user_id, p.created_at, p.viewer_bucket_stable
     FROM public.posts p, me
    WHERE p.user_id = me.uid AND (_categories IS NULL OR p.categories && _categories)
    ORDER BY p.created_at DESC LIMIT _own)
  UNION
  (SELECT p.id, p.user_id, p.created_at, p.viewer_bucket_stable
     FROM public.posts p
    WHERE p.privacy = 'friends'
      AND (_categories IS NULL OR p.categories && _categories)
      AND p.user_id IN (
        SELECT CASE WHEN f.requester_id = m2.uid THEN f.addressee_id ELSE f.requester_id END
          FROM public.friendships f, me m2
         WHERE f.status = 'accepted'
           AND (f.requester_id = m2.uid OR f.addressee_id = m2.uid))
    ORDER BY p.created_at DESC LIMIT _friends);
$function$;

CREATE OR REPLACE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text, created_at timestamp with time zone, likes_count integer, comments_count integer, shares_count integer, feed_tier text, author_name text, author_avatar text, thumbnail_urls text[], categories text[])
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH seed AS (
    -- Per viewer, per hour. Old callers send no seed, so one is derived: each
    -- member gets their own shuffle, stable for an hour, reshuffled after —
    -- closer to the old per-call random() re-deal than a fixed seed would be,
    -- and it keeps _exclude_ids paging coherent within the hour.
    SELECT to_char(now(), 'YYYYMMDDHH24') || coalesce(auth.uid()::text, 'anon') AS s
  ),
  pool AS (
    SELECT c.id, c.user_id, c.created_at, c.bucket
    FROM seed, public.feed_candidates(seed.s, _categories) c
    WHERE NOT (c.id = ANY(COALESCE(_exclude_ids, '{}'::uuid[])))
  ),
  visible AS (
    SELECT pl.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count, pl.bucket
    FROM pool pl
    JOIN public.posts p ON p.id = pl.id
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
    FROM public.feed_events fe
    WHERE fe.user_id = auth.uid()
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
  -- The count(DISTINCT) LATERAL that used to run once per visible post is gone.
  -- viewer_bucket_stable carries the same signal, precomputed. That LATERAL was
  -- 1,032 of 1,072 buffers at 210 posts and 97% of the cost at 100k.
  unseen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY public.feed_rank_score(v.id, v.bucket, (SELECT s FROM seed)) ASC, v.id
           ) AS rn
    FROM visible v
    WHERE NOT EXISTS (SELECT 1 FROM seen s WHERE s.post_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM newest n WHERE n.id = v.id)
  ),
  seen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY floor(extract(epoch FROM (now() - s.last_seen_at)) / 86400.0) DESC,
                      public.feed_rank_score(v.id, v.bucket, (SELECT s FROM seed)) ASC
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

CREATE OR REPLACE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text, created_at timestamp with time zone, likes_count integer, comments_count integer, shares_count integer, feed_tier text, author_name text, author_avatar text, thumbnail_urls text[], categories text[])
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, NULL::text[]);
$function$;

CREATE OR REPLACE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer)
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text, created_at timestamp with time zone, likes_count integer, comments_count integer, shares_count integer, feed_tier text, author_name text, author_avatar text, thumbnail_urls text[], categories text[])
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, 0, NULL::text[]);
$function$;

CREATE OR REPLACE FUNCTION public.get_post_view_counts(_post_ids uuid[])
 RETURNS TABLE(post_id uuid, views integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id AS post_id,
         (SELECT count(DISTINCT fe.user_id)::int
            FROM public.feed_events fe
           WHERE fe.post_id = p.id
             AND fe.event_type IN ('view', 'skip')
             AND fe.user_id <> p.user_id)
  FROM public.posts p
  WHERE p.id = ANY(_post_ids);
$function$;

CREATE OR REPLACE FUNCTION public.rate_limit_feed_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.feed_events
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 500 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 500 feed events per hour';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_feed_events_viewer_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.event_type NOT IN ('view','skip') THEN RETURN NEW; END IF;
  -- Only the FIRST view/skip by this member on this post counts, so the column
  -- means "distinct viewers" and matches the backfill above.
  IF EXISTS (SELECT 1 FROM public.feed_events fe
             WHERE fe.post_id = NEW.post_id AND fe.user_id = NEW.user_id
               AND fe.event_type IN ('view','skip') AND fe.id <> NEW.id) THEN
    RETURN NEW;
  END IF;
  UPDATE public.posts SET viewer_count = viewer_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.validate_feed_event_author()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  real_author uuid;
BEGIN
  -- Look up the actual author from the posts table
  SELECT user_id INTO real_author
  FROM public.posts
  WHERE id = NEW.post_id::uuid;

  IF real_author IS NULL THEN
    -- Post doesn't exist, reject the event
    RAISE EXCEPTION 'Invalid post_id: post does not exist';
  END IF;

  -- Override client-provided author_id with real value
  NEW.author_id := real_author;

  -- Prevent self-interaction boosting for ranking-relevant events
  IF NEW.user_id = real_author AND NEW.event_type IN ('like', 'share', 'comment') THEN
    -- Allow the event but neutralize it (won't boost own ranking)
    NEW.event_type := 'self_' || NEW.event_type;
  END IF;

  RETURN NEW;
END;
$function$;
