-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261013_0005 — Stage L2 feed session seed
-- Lanes: staging and production (refuses any other lane).
--
-- Restores the exact pre-20261013_0005 state of every object it touched:
--   * the 4-argument get_broadcast_feed gets production's 2026-10-13 body back,
--     verbatim (md5 96a65d7037ecc5351da75a28f8cace73 — the value PRE-001 of the
--     migration required); CREATE OR REPLACE keeps its OID and ACL;
--   * the 5-argument overload is dropped (nothing else depends on it: the
--     4-argument one stops calling it first, in this same transaction).
-- The 2- and 3-argument overloads were never touched and are not touched here.
--
-- CLIENT IMPACT: a client that sends _session_seed (L2 PR B) gets PGRST202 for
-- the 5-argument call and falls back to the 4-argument call (useFeedQuery.ts),
-- so the feed keeps loading with the hourly order. Roll the client back too if
-- the old order is the goal.
--
-- RB-PRE-001 refuses unless the objects are in 20261013_0005's post-state, so
-- this cannot run before the migration, twice, or over a later change.
-- RB-POST-001 proves the restored state: 3 overloads, production's bodies and
-- ACLs. (20261013_0005 created no index, so there is none to drop.)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb_preconditions$
BEGIN
  -- RB-PRE-001 · 20261013_0005's post-state: the 5-argument overload exists and
  -- the 4-argument one is the one-line wrapper.
  IF to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[], text)') IS NULL
     OR (SELECT btrim(prosrc, E' \r\n\t') FROM pg_proc
          WHERE oid = to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])'))
        IS DISTINCT FROM 'SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, _categories, NULL::text);' THEN
    RAISE EXCEPTION 'L2-0005-RB-PRE-001: get_broadcast_feed is not in 20261013_0005''s post-state — nothing to roll back, or a later change touched it'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

-- 1. The 4-argument overload: production's body, verbatim.
CREATE OR REPLACE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text, created_at timestamp with time zone, likes_count integer, comments_count integer, shares_count integer, feed_tier text, author_name text, author_avatar text, thumbnail_urls text[], categories text[])
 LANGUAGE sql
 VOLATILE
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

-- 2. The 5-argument overload goes.
DROP FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[], text);

DO $rb_postconditions$
DECLARE
  _bad text := '';
  r    record;
BEGIN
  -- RB-POST-001 · exactly the three production overloads, production's bodies and ACL.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_broadcast_feed') <> 3 THEN
    _bad := _bad || E'\n  expected exactly 3 get_broadcast_feed overloads';
  END IF;
  FOR r IN
    SELECT v.sig, v.want, p.oid AS fn_oid, md5(p.prosrc) AS got
      FROM (VALUES
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer)', '6ff8f8ea3d8c8cf76e9abe0bd728915e'),
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)', '59cebfbcfd89f6ad49e46399ee6fe4e2'),
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])', '96a65d7037ecc5351da75a28f8cace73')
      ) AS v(sig, want)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.fn_oid IS NULL OR r.got IS DISTINCT FROM r.want THEN
      _bad := _bad || E'\n  ' || r.sig || ' md5 ' || coalesce(r.got, 'missing') || ', expected ' || r.want;
    ELSIF has_function_privilege('public', r.fn_oid, 'EXECUTE')
       OR has_function_privilege('anon', r.fn_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.fn_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.fn_oid, 'EXECUTE') THEN
      _bad := _bad || E'\n  ' || r.sig || ' EXECUTE is not exactly authenticated + service_role (+ owner)';
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'L2-0005-RB-POST-001: the restored state is not production''s 2026-10-13 state:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'L2-0005 ROLLBACK: 3 production overloads restored (4-argument md5 96a65d70…), 5-argument overload removed';
END
$rb_postconditions$;

COMMIT;
