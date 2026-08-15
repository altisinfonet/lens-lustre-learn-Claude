-- ═══════════════════════════════════════════════════════════════════════════
-- get_broadcast_feed STOPS SCANNING EVERY POST.
--
-- This is the second half of the change begun in 20260814070357, which added
-- the columns and `feed_candidates()` but deliberately left this function
-- alone. That separation was the point: DROP/CREATE here is the single riskiest
-- operation in this database, so the schema could land, be verified and be
-- reverted on its own before anything came near it.
--
-- Measured on a local PG16 harness at 1,000,000 posts, production ratios:
--
--   today                4,836,645 buffers   9,489 ms   + external merge, 148 MB to disk
--   this definition          1,656 buffers       8 ms
--
-- ⚠ TRAP #3 — READ BEFORE EDITING.
--   `CREATE OR REPLACE FUNCTION` cannot add a returned column:
--     ERROR: cannot change return type of existing function
--   It needs DROP FUNCTION, and **DROP DESTROYS THE GRANTS.** A migration that
--   forgets to re-grant leaves the feed working for the owner (who is
--   `postgres`) and BLANK for every real member. Everything below is one
--   transaction, so there is no instant where the function does not exist, and
--   the grants are re-issued explicitly at the end.
--
-- ⚠ ALL THREE SIGNATURES ARE RECREATED. The 2-arg and 3-arg forms are what
--   ALREADY-INSTALLED Android builds call — 1073 is in Play and builds to 1088
--   exist in the field. Dropping them would break every phone that has not
--   updated. They keep their exact 15-column shape.
--
-- ⚠ THIS FILE MUST KEEP THE WORD `VOLATILE` AND THE STRING `feed_tier text`.
--   `feedFreshness.test.ts` resolves the NEWEST migration defining this
--   function at run time and asserts both. A previous migration of mine dropped
--   the explicit VOLATILE and reformatted the column list, and the suite failed
--   — correctly. The guard exists because the COALESCE fix was silently
--   reverted for 8 days with that test green.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT CHANGED, AND WHAT DID NOT
--
-- CHANGED: `visible` no longer means "every post this member may see". It is
-- now `feed_candidates()` — the 500 newest public posts, a uniform random slice
-- of the whole public corpus, the member's own posts, and their friends'. The
-- ranking then runs over ~1,500 rows instead of the entire table.
--
-- NOT CHANGED: the three tiers (`newest` / `unseen` / `recycled`), their order,
-- the seen/skip rules, the 15 returned columns, or the meaning of
-- `_exclude_ids` for existing callers.
--
-- WHY A RANDOM SLICE IS IN THE POOL AT ALL: without it, a photograph older than
-- the newest 500 could never be resurfaced, which is precisely the reach
-- fairness the unseen/recycled tiers exist to provide. Measured over 500
-- simulated sessions: 92,805 of 800,000 distinct posts reached, average age of
-- reached posts 215.0 days against a corpus average of 214.7 — no recency bias.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE SEED
--
-- Ordering is `viewer_bucket_stable + hash(post_id || seed)`, which is
-- deterministic — that is what makes a keyset cursor correct and lets the
-- exclusion array go away for new callers.
--
-- Old callers send no seed, so one is derived per viewer per hour:
--   to_char(now(),'YYYYMMDDHH24') || coalesce(auth.uid()::text,'anon')
-- Each member gets their own shuffle, stable for an hour, reshuffled after —
-- closer to the old per-call `random()` re-deal than a fixed seed would be, and
-- it keeps `_exclude_ids` paging coherent within the hour.
--
-- ⚠ A CLIENT-SUPPLIED SEED MUST BE A PER-SESSION CSPRNG VALUE, never derived
-- from the date, a user id, or a request hash. Two members sharing a seed
-- receive an identical ordering — measured: 1,500 of 1,500 shared posts scored
-- identically — so a predictable seed would let one infer the other's feed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.get_broadcast_feed(uuid[], integer, integer, text[]);
DROP FUNCTION IF EXISTS public.get_broadcast_feed(uuid[], integer, integer);
DROP FUNCTION IF EXISTS public.get_broadcast_feed(uuid[], integer);

-- ── The 4-argument form: what current clients call. 15 columns, unchanged.
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
  WITH seed AS (
    -- Per viewer, per hour. See the header: old callers send no seed.
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

-- ── The 3-argument form: shipped Android builds before categories.
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

-- ── The 2-argument form: the oldest still-installed callers.
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

-- ── 4. The grants DROP just destroyed.
--
-- Read from production before this migration (pg_proc.proacl):
--   4-arg : postgres, anon, authenticated, service_role      — no PUBLIC
--   3-arg : PUBLIC, postgres, anon, authenticated, service_role
--   2-arg : PUBLIC, postgres, anon, authenticated, service_role
--
-- The PUBLIC entries on the legacy forms are Postgres's CREATE-time default,
-- not a decision. All three are normalised: PUBLIC revoked, named roles granted.
-- Nothing loses access — anon and authenticated are granted explicitly, and they
-- are every caller that exists.
--
-- The feed is deliberately reachable by `anon`: a logged-out visitor sees the
-- public feed. The visibility filter is INSIDE — `feed_candidates()` resolves
-- the viewer from auth.uid(), so an anonymous caller gets public posts only.

REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer)                  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer)         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer)                  TO anon, authenticated, service_role;

COMMIT;
