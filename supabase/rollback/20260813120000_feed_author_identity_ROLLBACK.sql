-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260813120000_feed_author_identity.sql
--
-- Restores get_broadcast_feed to its 2026-08-12 shape: eleven columns, no
-- author identity, no thumbnail_urls, no categories.
--
-- ⚠ NOT IN supabase/migrations/. This directory is deliberately outside the
-- migration path so nothing here is ever applied automatically. It is run by
-- hand, by a human who has decided to roll back.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠ THE OBVIOUS ROLLBACK DOES NOT WORK. THIS FILE EXISTS BECAUSE OF THAT.
--
-- The instinct at 2am is "just re-run 20260812070000_post_categories.sql".
-- That file uses CREATE OR REPLACE, and against the 15-column function it
-- fails — measured, not assumed:
--
--     ERROR:  cannot change return type of existing function
--     DETAIL: Row type defined by OUT parameters is different.
--     HINT:   Use DROP FUNCTION get_broadcast_feed(uuid[],integer,integer,text[]) first.
--
-- So the escape hatch everyone would reach for first is closed, and it is
-- closed in exactly the moment you least want to be reading Postgres hints.
-- Rolling back a returned-column change requires a DROP in both directions.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT THIS RESTORES, AND WHAT IT DOES NOT
--
-- The three function bodies below are extracted VERBATIM from
-- 20260812070000_post_categories.sql — the definition that was live before
-- 2026-08-13. Only two mechanical edits were made:
--
--   1. CREATE OR REPLACE -> CREATE, because the DROPs above make REPLACE wrong.
--   2. The REVOKE line moved below, next to the GRANTs it belongs with.
--
-- ⚠ THIS ALSO REVERTS THE COALESCE(_exclude_ids) GUARD. That guard is a
-- genuine bug fix that rode along in the same migration, and rolling back
-- reinstates the defect: get_broadcast_feed(NULL, ...) will again return zero
-- rows with a 200, which the client reads as "end of feed". The app never
-- sends NULL today, so this is a latent class rather than a live outage — but
-- know that you are putting it back, and put it right again afterwards.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠ THE CLIENT NEEDS NO ROLLBACK, AND THAT IS BY DESIGN.
--
-- useFeedQuery decides what to read from the SHAPE of the row
-- (`"author_name" in first`), never from a version constant. After this file
-- runs, the columns are simply absent, the check goes false, and the client
-- falls back to resolving names through fetchProfileMap exactly as it did
-- before. No bundle needs to be rebuilt, no APK needs to be republished, and
-- there is no ordering requirement between the two halves — in either
-- direction. That property is the reason the detection was written that way.
--
-- ───────────────────────────────────────────────────────────────────────────
-- HOW TO RUN
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20260813120000_feed_author_identity_ROLLBACK.sql
--
-- One transaction. Do not paste the statements in one at a time: between the
-- DROP and the CREATE there is no feed function at all, and only the
-- transaction hides that from live callers.
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
      -- ── THE ONLY LINE ADDED TO THE FEED LOGIC ────────────────────────────
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

-- The two legacy signatures, now thin wrappers. Byte-for-byte the same result
-- shape, so an installed Android build calling either keeps working unchanged.
CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}',
  _limit integer DEFAULT 10,
  _newest_first integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, user_id uuid, content text, image_url text, image_urls text[],
  privacy text, created_at timestamptz, likes_count integer,
  comments_count integer, shares_count integer, feed_tier text
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, NULL::text[]);
$$;

-- ⚠ THE DEFAULTS ON THESE TWO PARAMETERS ARE NOT OPTIONAL, AND OMITTING THEM
-- IS WHAT MADE THE FIRST APPLY ATTEMPT FAIL ON PRODUCTION (2026-08-12):
--
--     ERROR 42P13: cannot remove parameter defaults from existing function
--     HINT: Use DROP FUNCTION get_broadcast_feed(uuid[],integer) first.
--
-- `CREATE OR REPLACE FUNCTION` may ADD a default but may never REMOVE one. The
-- live 2-arg function is declared, verbatim from pg_get_function_arguments():
--     _exclude_ids uuid[] DEFAULT '{}'::uuid[], _limit integer DEFAULT 10
-- so this wrapper must repeat both exactly. The 3-arg one below already did.
--
-- DROP FUNCTION was the other way out and is REJECTED: dropping a live feed
-- function, even for the instant before it is recreated, is a window in which
-- every installed app calling it gets an error. Matching the signature costs
-- nothing and has no window at all.
--
-- Side note, and the reason this is worth reading twice: because BOTH of these
-- parameters carry defaults, and the 3-arg version defaults all three, a
-- 2-argument call is ambiguous between the two candidates. That is the
-- pre-existing defect recorded separately in the Phase B audit — it is
-- reproduced here EXACTLY as it already exists on production, deliberately not
-- fixed, because fixing it means dropping a signature and that is a different
-- change with its own blast radius.
CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}'::uuid[],
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid, user_id uuid, content text, image_url text, image_urls text[],
  privacy text, created_at timestamptz, likes_count integer,
  comments_count integer, shares_count integer, feed_tier text
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, 0, NULL::text[]);
$$;


-- Grants do not survive a DROP. Without these the feed is invisible to every
-- real user while still working perfectly for the owner running the rollback.
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer) TO anon, authenticated;

DO $rb$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname='public' AND pr.proname='get_broadcast_feed';
  IF n <> 3 THEN
    RAISE EXCEPTION 'rollback: expected 3 signatures, found %', n;
  END IF;

  -- The four columns must be GONE. If any survived, the rollback did not roll
  -- back and the client would keep reading a column the database no longer
  -- populates correctly.
  SELECT count(*) INTO n
  FROM unnest((SELECT pr.proargnames FROM pg_proc pr
               JOIN pg_namespace ns ON ns.oid=pr.pronamespace
               WHERE ns.nspname='public' AND pr.proname='get_broadcast_feed'
                 AND pr.pronargs=4)) AS a(name)
  WHERE a.name IN ('author_name','author_avatar','thumbnail_urls','categories');
  IF n <> 0 THEN
    RAISE EXCEPTION 'rollback: % identity column(s) still present', n;
  END IF;

  RAISE NOTICE 'get_broadcast_feed rolled back to the 11-column 2026-08-12 shape. The COALESCE(_exclude_ids) guard is now ABSENT again — see the header.';
END
$rb$;

COMMIT;
