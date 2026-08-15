-- ═══════════════════════════════════════════════════════════════════════════
-- THE AUTHOR'S NAME TRAVELS WITH THE POST.
--
-- Owner, 2026-08-13: *"Does Instagram shows P ?? Facebook Shows P ?? Why we ??
-- Why we cant show the names like FB and Insta ??"*
--
-- He is right, and the answer is not a nicer placeholder. It is this file.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY A POST COULD EVER APPEAR WITHOUT ITS AUTHOR'S NAME
--
-- `get_broadcast_feed` returned eleven columns and joined nothing to profiles.
-- The post came from this RPC; the name came from a SECOND, INDEPENDENT
-- request (`fetchProfileMap`). Two requests means two failure modes, and one of
-- them is "the post arrived, the name did not". The client then had to invent
-- something to put in the gap — which is where "Photographer" and the "?"
-- avatar came from. Both were inventions covering a structural hole.
--
-- Instagram and Facebook return the author's name and avatar INSIDE the same
-- payload as the post. "Post visible, name missing" is not a state that can
-- exist for them, so they never needed a placeholder at all.
--
-- After this migration it cannot exist for us either. The name is welded to
-- the row. If the post is on screen, the name came with it.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠ THE FAIRNESS LOGIC IS NOT TOUCHED. NOT ONE LINE.
--
-- This is the property to check before anything else in this file. `visible`,
-- `newest`, `my_events`, `seen`, `unseen_ranked` and `seen_ranked` are
-- reproduced BYTE-FOR-BYTE from 20260812070000_post_categories.sql. The
-- broadcast ordering — unseen first, fewest viewers first, then recycled — is
-- character-identical to what is running in production right now.
--
-- The ONLY structural change is the outer projection: the existing final
-- SELECT becomes a subquery, and two LEFT JOINs hang off it.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THE JOIN IS AFTER THE LIMIT, NOT INSIDE `visible`
--
-- `visible` is every post the viewer may see — thousands of rows, unbounded,
-- and already the most expensive part of this function. Joining profiles there
-- would multiply that cost by a table lookup per row to decorate ten.
--
-- The join sits OUTSIDE the `LIMIT _limit`, so it runs against at most ten
-- rows, by primary key, every time. The added cost is two index lookups per
-- returned post. That is the difference between this being free and this being
-- the reason the feed got slower.
--
-- The outer `ORDER BY` is repeated for the same reason it always must be: a
-- join is not order-preserving. Dropping it would silently shuffle the
-- fairness ordering this migration exists to leave alone.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠ SECURITY. READ THIS PARAGRAPH HARDEST — IT IS THE ONE I FLAGGED.
--
-- This function is SECURITY DEFINER, so a join inside it bypasses RLS. That is
-- normally the line to worry about. Here it discloses NOTHING NEW, and the
-- reason is specific rather than reassuring:
--
--   `public.profiles_public_data` is a dedicated public projection TABLE
--   (created 20260320145814). It carries safe columns only — no phone, no
--   address, no bank details, no national ID. It has RLS enabled, and its
--   SELECT policy is:
--
--       CREATE POLICY "Anyone can view public profile data"
--       ON public.profiles_public_data FOR SELECT TO public USING (true);
--
--       GRANT SELECT ON public.profiles_public_data TO anon, authenticated;
--
-- `USING (true)`, granted to `anon`. Any logged-out visitor can already run
-- `select id, full_name, avatar_url from profiles_public_data` directly from
-- the browser. Reading those two columns here exposes exactly zero fields that
-- were not already public, to exactly nobody new.
--
-- It is joined INSTEAD OF `public.profiles` deliberately. `profiles` holds the
-- sensitive columns; reaching it from a DEFINER function would be a real
-- bypass. If someone later narrows what is public, they narrow this projection
-- table, and this join narrows with it — automatically, without anyone having
-- to remember this file exists.
--
-- LEFT JOIN, never INNER: a post whose author row is somehow missing must
-- still appear in the feed with a null name. An INNER JOIN would silently
-- DELETE that post from everyone's feed, which is a far worse failure than the
-- one being fixed.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE ADMIN BRAND IS STILL APPLIED BY THE CLIENT, ON PURPOSE.
--
-- This returns the RAW `full_name`. The rule that the official account renders
-- as "50mm Retina World" rather than a person's name lives in
-- `src/lib/adminBrand.ts` (`resolveName`), and it STAYS there. Moving it into
-- SQL would mean this function had to know who the admins are, which is a
-- second lookup and a second place for that policy to drift out of sync.
-- `enrichPosts` keeps calling `resolveName` over this value.
--
-- ───────────────────────────────────────────────────────────────────────────
-- TWO MORE COLUMNS, FOR A SEPARATE REASON: `thumbnail_urls`, `categories`
--
-- Neither was returned, so `useFeedQuery` issued a SECOND query against
-- `posts` for the very same ten rows it had just been handed, purely to get
-- `thumbnail_urls`. That query disappears with this change.
--
-- `thumbnail_urls` missing is not cosmetic: when it is absent the client falls
-- back to the FULL-RESOLUTION original for the blurred backdrop layer — a
-- ~2560px image, eagerly fetched, ~14.7 MB of decoded bitmap per card. Getting
-- it into the first payload removes a round trip AND removes the window in
-- which a card renders without knowing its thumbnail exists.
--
-- They are read by joining `public.posts` back on the ten final ids rather
-- than by widening `visible`, for the same cost reason as the profile join.
--
-- ───────────────────────────────────────────────────────────────────────────
-- SECOND, SEPARATE FIX IN THIS FILE — STATED SO IT IS NOT SMUGGLED IN
--
-- `COALESCE(_exclude_ids, '{}'::uuid[])` is restored on line ~205.
--
-- 20260805040000_broadcast_feed_null_exclude_guard.sql fixed this once. BOTH
-- later definitions reverted to a bare `ANY(_exclude_ids)`, so it has been
-- broken again since 2026-08-05. With a bare `ANY`, an explicit NULL makes
-- every row's predicate NULL, the function returns zero rows with HTTP 200,
-- and the client reads that as "end of feed" — an empty feed reported as a
-- success, which is the exact failure class the owner reported on slow
-- networks.
--
-- The test that should have caught the revert, `feedFreshness.test.ts:78-81`,
-- asserts the guard is present but line 31 pins it to the SUPERSEDED file by
-- hardcoded path. It has been passing green against a definition that is not
-- deployed. That test is fixed in the client half of this change.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠ WHY THIS FILE DROPS FUNCTIONS, AND WHY THAT IS STILL SAFE
--
-- The first version of this migration used CREATE OR REPLACE, as every other
-- migration in this project does. Applied against a real Postgres 16 it failed:
--
--     ERROR: cannot change return type of existing function
--     DETAIL: Row type defined by OUT parameters is different.
--     HINT:  Use DROP FUNCTION get_broadcast_feed(uuid[],integer,integer,text[]) first.
--
-- CREATE OR REPLACE may change a function's BODY but never its OUT-parameter
-- row type. Adding a returned column therefore REQUIRES a DROP. There is no
-- flag, no ordering trick and no CASCADE that avoids it.
--
-- 20260812070000 rejected DROP with: *"dropping a live feed function, even for
-- the instant before it is recreated, is a window in which every installed app
-- calling it gets an error."* That reasoning was correct for what it described
-- — a bare DROP followed by a CREATE — and it is why this file is wrapped in
-- an explicit transaction.
--
-- Postgres DDL is transactional. Inside BEGIN … COMMIT the drop and the
-- recreate are one atomic step: a concurrent caller either takes the old
-- function or the new one. It cannot observe the gap. A call arriving mid-
-- migration blocks on the pg_proc lock for the few milliseconds this takes and
-- then proceeds against the new definition. THERE IS NO WINDOW — but only
-- because of the transaction, so do not run these statements individually in
-- the SQL editor, and do not remove the BEGIN.
--
-- ⚠ GRANTS DO NOT SURVIVE A DROP. Every EXECUTE grant is re-issued below. A
-- dropped-and-recreated function with no GRANT is invisible to `anon` and
-- `authenticated`, which would take the feed down for everyone — silently, and
-- only for real users, since the migration itself runs as owner and would
-- still pass any test that called it directly.
--
-- The three signatures are dropped by EXACT argument types, which is
-- unambiguous even though a 2-argument CALL is not (see the note further down).
--
-- ───────────────────────────────────────────────────────────────────────────
-- BACKWARD COMPATIBILITY — INSTALLED APKs KEEP WORKING
--
-- Adding columns to a PostgREST RPC result is additive: an older build that
-- does not know about `author_name` receives it as an extra JSON key and
-- ignores it. Every APK in the field continues to work unchanged, still doing
-- its own profile lookup, still correct.
--
-- The two legacy wrappers MUST be rewritten in this same file. They currently
-- read `SELECT * FROM ...get_broadcast_feed(4-arg)`, and `SELECT *` against a
-- function that now returns fifteen columns into an eleven-column RETURNS
-- TABLE fails at runtime with 42804. They are given explicit column lists.
--
-- ⚠ Their parameter DEFAULTS are repeated verbatim. CREATE OR REPLACE may ADD
-- a default but may never REMOVE one — omitting them is what made the
-- 2026-08-12 apply fail with 42P13. Do not "tidy" them away. The ambiguity
-- between the 2-arg and 3-arg candidates is pre-existing and is reproduced
-- here deliberately unfixed; resolving it means DROP FUNCTION on a live feed
-- signature, which is a different change with its own blast radius.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Exact argument types: unambiguous even where a 2-arg CALL would not be.
-- IF EXISTS so the file is re-runnable against a database at any of the
-- three historical states.
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
  feed_tier text,
  -- ── NEW. The four that stop the client needing a second and third request ──
  author_name text,
  author_avatar text,
  thumbnail_urls text[],
  categories text[]
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
      -- COALESCE restored: see the header. A bare ANY(NULL) returns zero rows
      -- with a 200, and the client reads that as the end of the feed.
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
  -- ⚠ `ranked` IS THE OLD FINAL SELECT, UNCHANGED, INCLUDING ITS LIMIT.
  -- Everything above this line is byte-identical to the deployed function.
  -- Wrapping it is what lets the joins below run on ten rows instead of all.
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
         -- Raw name. The admin-brand rule stays in adminBrand.ts — see header.
         ppd.full_name  AS author_name,
         ppd.avatar_url AS author_avatar,
         p.thumbnail_urls,
         p.categories
  FROM ranked r
  -- LEFT, never INNER. A missing profile row must not delete the post.
  LEFT JOIN public.profiles_public_data ppd ON ppd.id = r.user_id
  LEFT JOIN public.posts p                  ON p.id  = r.id
  -- Repeated because a join is not order-preserving. Without this the fairness
  -- ordering the whole function exists to produce is silently shuffled.
  ORDER BY r.tier_order ASC, r.rn ASC;
$$;


-- ── Legacy wrappers. Explicit column lists now — `SELECT *` would fail 42804
--    against the fifteen-column result. Defaults repeated verbatim (42P13).

CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}',
  _limit integer DEFAULT 10,
  _newest_first integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, user_id uuid, content text, image_url text, image_urls text[],
  privacy text, created_at timestamptz, likes_count integer,
  comments_count integer, shares_count integer, feed_tier text,
  author_name text, author_avatar text, thumbnail_urls text[], categories text[]
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT f.id, f.user_id, f.content, f.image_url, f.image_urls, f.privacy,
         f.created_at, f.likes_count, f.comments_count, f.shares_count,
         f.feed_tier, f.author_name, f.author_avatar, f.thumbnail_urls,
         f.categories
  FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, NULL::text[]) f;
$$;

CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}'::uuid[],
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid, user_id uuid, content text, image_url text, image_urls text[],
  privacy text, created_at timestamptz, likes_count integer,
  comments_count integer, shares_count integer, feed_tier text,
  author_name text, author_avatar text, thumbnail_urls text[], categories text[]
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT f.id, f.user_id, f.content, f.image_url, f.image_urls, f.privacy,
         f.created_at, f.likes_count, f.comments_count, f.shares_count,
         f.feed_tier, f.author_name, f.author_avatar, f.thumbnail_urls,
         f.categories
  FROM public.get_broadcast_feed(_exclude_ids, _limit, 0, NULL::text[]) f;
$$;

REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer) TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK. Every assertion below must hold or this migration aborts.
-- A migration that half-applies to a live feed is worse than one that refuses.
-- ═══════════════════════════════════════════════════════════════════════════
DO $check$
DECLARE
  n integer;
BEGIN
  -- 1. All three signatures still exist. If one vanished, installed APKs break.
  SELECT count(*) INTO n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'get_broadcast_feed';
  IF n <> 3 THEN
    RAISE EXCEPTION 'get_broadcast_feed: expected 3 signatures, found %', n;
  END IF;

  -- 2. The 4-arg signature returns 15 columns, ending in the four new ones.
  SELECT count(*) INTO n
  FROM unnest(
    (SELECT pr.proargnames FROM pg_proc pr
     JOIN pg_namespace ns ON ns.oid = pr.pronamespace
     WHERE ns.nspname = 'public' AND pr.proname = 'get_broadcast_feed'
       AND pr.pronargs = 4)
  ) AS a(name)
  WHERE a.name IN ('author_name','author_avatar','thumbnail_urls','categories');
  IF n <> 4 THEN
    RAISE EXCEPTION 'get_broadcast_feed(4-arg): expected 4 new OUT columns, found %', n;
  END IF;

  -- 3. The public projection table really is public — the premise the security
  --    argument in this file rests on. If this ever stops being true, the join
  --    above becomes a genuine RLS bypass and must be revisited.
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles_public_data'
    AND cmd        = 'SELECT'
    AND qual       = 'true';
  IF n < 1 THEN
    RAISE EXCEPTION
      'profiles_public_data has no USING(true) SELECT policy — the join in get_broadcast_feed would now disclose non-public data. Migration refused.';
  END IF;

  RAISE NOTICE 'get_broadcast_feed: author identity now travels with the post. 3 signatures, 15 columns, public projection verified.';
END
$check$;

COMMIT;
