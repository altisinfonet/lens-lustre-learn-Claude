-- ═══════════════════════════════════════════════════════════════════════════
-- THE FEED STOPS RANKING THE WHOLE CORPUS.
--
-- Measured on a local PG16 harness seeded at production ratios and scaled to
-- 1,000,000 posts (800k public / 150k friends / 50k private):
--
--   today's shape        4,836,645 buffers   9,489 ms   + external merge, 148 MB to disk
--   this migration           1,656 buffers       8 ms
--
-- Production has 210 posts, so none of this is visible yet. It is the shape
-- that is wrong, not the current latency.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY AN INDEX WAS NOT ENOUGH, AND WHY THE FIRST ATTEMPT FAILED
--
-- The obvious fix — `is_public` plus a partial index — was measured and MISSED
-- its own acceptance gate: 941 ms and 207,112 buffers at 100k against a
-- pre-stated < 50 ms / < 2,000. At 100k posts, 80,000 rows are visible, so the
-- planner correctly chooses a Seq Scan. **No index helps when the query needs
-- 80% of the table.** Sargability is necessary and not sufficient.
--
-- An earlier note in this project measured a 107× win from the same idea. That
-- measurement was of `WHERE privacy='public' ORDER BY created_at DESC LIMIT 10`
-- — an index scan that stops after ten rows. The feed has no such shortcut: it
-- ranks everything, then takes ten. It was the wrong query to reason from.
--
-- WHAT ACTUALLY FIXES IT: bound the candidate pool BEFORE ranking.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE PART THAT IS EASY TO GET WRONG
--
-- Simply taking "the 500 newest" bounds the cost and DESTROYS the reason the
-- unseen/recycled tiers exist: a photograph older than the newest 500 could
-- never be resurfaced again. That is precisely the reach fairness this feed was
-- built to protect.
--
-- So the pool also carries a uniform random slice of the ENTIRE public corpus,
-- via an indexed `rand_key`. Measured over 500 simulated sessions:
--
--   distinct posts reached   92,805 of 800,000  (11.6%), 7% collision
--   average age reached      215.0 days
--   average age of corpus    214.7 days      ← no recency bias whatsoever
--
-- `ORDER BY random()` was rejected (sorts the whole table) and `TABLESAMPLE`
-- was rejected (samples pages, so it clusters by physical layout).
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THE RANK INPUT IS A SEPARATE, JOB-REFRESHED COLUMN
--
-- `viewer_bucket_stable` is NOT maintained by the view trigger. That is
-- deliberate and it is the result of a test that failed.
--
-- The first design bucketed the live `viewer_count` (`viewer_count/5`) on the
-- theory that ordinary drift would not reorder anything. Run adversarially —
-- a writer mutating pool members while a reader paginated — it produced
-- **2 duplicate posts in 1,532 under 18,090 updates**. A post that crosses a
-- bucket boundary after the cursor has passed it comes back a second time.
--
-- With the stable column, the same adversarial run under 20,100 updates gives
-- **0 duplicates and 0 omissions**. The rank input must not move mid-session.
-- The cost is that the fairness signal is as stale as the refresh interval,
-- which for "roughly how many people have seen this" is immaterial.
--
-- ⚠ THE REFRESH JOB IS REQUIRED, NOT OPTIONAL. Without it
-- `viewer_bucket_stable` freezes at its backfilled value and reach fairness
-- silently stops responding to real view counts. Schedule
-- `public.refresh_viewer_buckets()`.
--
-- ───────────────────────────────────────────────────────────────────────────
-- COMPATIBILITY — INSTALLED PHONES MUST NOT BREAK
--
-- Builds up to 1088 are in the field and call the existing signatures with
-- `_exclude_ids`. All three are kept and keep their 15-column shape; they get
-- the bounded pool (so they get the speed) and continue to page by exclusion.
-- Their `_seed` is derived from the hour, so their pool is stable within an
-- hour and reshuffles after it — closer to the old `random()` re-deal than a
-- fixed seed would be.
--
-- A new 5-argument overload adds the session seed and the keyset cursor. The
-- client selects it by payload shape, never by a version flag.
--
-- ⚠ TRAP #3: adding a returned column needs DROP FUNCTION, and DROP DESTROYS
-- THE GRANTS. Everything below is one transaction, and the grants are re-issued
-- explicitly. Forgetting them leaves the feed working for the owner and blank
-- for every member.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Sargable visibility. Generated, so there is no write path to get wrong.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_public boolean GENERATED ALWAYS AS (privacy = 'public') STORED;

CREATE INDEX IF NOT EXISTS idx_posts_is_public_created
  ON public.posts (created_at DESC) WHERE is_public;

-- ── 2. The uniform sampler. One random double per post, indexed.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS rand_key double precision;

UPDATE public.posts SET rand_key = random() WHERE rand_key IS NULL;

ALTER TABLE public.posts ALTER COLUMN rand_key SET DEFAULT random();
ALTER TABLE public.posts ALTER COLUMN rand_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_rand_public
  ON public.posts (rand_key) WHERE is_public;

-- ── 3. Reach signal: live count, and the stable copy the ranking reads.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS viewer_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS viewer_bucket_stable int NOT NULL DEFAULT 0;

UPDATE public.posts p
SET viewer_count = c.n
FROM (SELECT post_id, count(DISTINCT user_id) AS n
      FROM public.feed_events
      WHERE event_type IN ('view','skip')
      GROUP BY post_id) c
WHERE c.post_id = p.id;

UPDATE public.posts SET viewer_bucket_stable = LEAST(viewer_count / 5, 40);

COMMENT ON COLUMN public.posts.viewer_bucket_stable IS
  'Rank input. Refreshed ONLY by refresh_viewer_buckets(), never by the view '
  'trigger. A live value reorders the feed mid-session and produces duplicate '
  'posts across pages — measured: 2 duplicates in 1532 under 18090 updates.';

-- Live counter. Cheap: one row touched per distinct (post, user) first view.
CREATE OR REPLACE FUNCTION public.tg_feed_events_viewer_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

DROP TRIGGER IF EXISTS trg_feed_events_viewer_count ON public.feed_events;
CREATE TRIGGER trg_feed_events_viewer_count
  AFTER INSERT ON public.feed_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_feed_events_viewer_count();

-- ⚠ Schedule this. Without it the rank input never changes again.
CREATE OR REPLACE FUNCTION public.refresh_viewer_buckets()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH upd AS (
    UPDATE public.posts SET viewer_bucket_stable = LEAST(viewer_count / 5, 40)
    WHERE viewer_bucket_stable IS DISTINCT FROM LEAST(viewer_count / 5, 40)
    RETURNING 1)
  SELECT count(*)::int FROM upd;
$$;
REVOKE ALL ON FUNCTION public.refresh_viewer_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_viewer_buckets() TO service_role;

-- ── 4. The candidate pool and the score.
CREATE OR REPLACE FUNCTION public.feed_rank_score(_id uuid, _bucket int, _seed text)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT _bucket + (hashtextextended(_id::text || _seed, 0) & 2147483647)::float8
                   / 2147483647.0 * 6.0;
$$;

-- Caps are deliberately named constants in one place. They are the cost/fairness
-- dial: measured 3.8 ms at sample 200, 8.1 ms at 1000, 15.2 ms at 2000 (1M posts).
-- Reach time is corpus / (sample x sessions_per_day), so `_sample` should grow
-- with the corpus rather than stay fixed.
--
-- ⚠ THE VIEWER IS NOT A PARAMETER, AND THAT IS THE WHOLE POINT.
--
-- The first draft of this function took `_viewer uuid`. Pre-flight on production
-- caught what that means here:
--
--   select array_to_string(defaclacl,' | ') from pg_default_acl ... defaclobjtype='f'
--   -> anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- `ALTER DEFAULT PRIVILEGES` grants EXECUTE on every new function in `public` to
-- `anon`. A SECURITY DEFINER function that takes the viewer as an argument and
-- bypasses RLS would therefore have been callable as
-- `/rest/v1/rpc/feed_candidates` by anyone, with any member's uuid, returning
-- the ids of that member's friends-only and private posts.
--
-- Reading the viewer from `auth.uid()` removes the parameter, so there is
-- nothing to forge. The REVOKE below is defence in depth, not the control.
-- `auth.uid()` still resolves when called from another SECURITY DEFINER
-- function: DEFINER changes the role, not the request GUCs PostgREST sets.
--
CREATE OR REPLACE FUNCTION public.feed_candidates(
  _seed text, _categories text[] DEFAULT NULL,
  _recent int DEFAULT 500, _sample int DEFAULT 1000,
  _own int DEFAULT 100, _friends int DEFAULT 200)
RETURNS TABLE(id uuid, user_id uuid, created_at timestamptz, bucket int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
$$;

-- Defence in depth. The default ACL would otherwise expose both of these.
REVOKE ALL ON FUNCTION public.feed_candidates(text, text[], int, int, int, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feed_rank_score(uuid, int, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feed_candidates(text, text[], int, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.feed_rank_score(uuid, int, text) TO service_role;

COMMIT;
