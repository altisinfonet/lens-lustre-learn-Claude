-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260814060000_feed_candidate_pool.sql
--
-- This migration is deliberately ADDITIVE — it adds columns, indexes, a trigger
-- and new functions, and does NOT touch `get_broadcast_feed`. Nothing reads the
-- new objects until a later migration rewrites the RPC, so rolling back cannot
-- change what any member sees.
--
-- That separation is the point. The riskiest operation in this database is
-- DROP/CREATE on `get_broadcast_feed` (trap #3: DROP destroys the grants, and a
-- missed re-GRANT leaves the feed working for the owner and blank for everyone
-- else). Doing the schema in one migration and the RPC in another means this
-- one can be reverted without going near it.
--
-- Order matters: the trigger goes first, so no write can touch `viewer_count`
-- after the column is gone.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER IF EXISTS trg_feed_events_viewer_count ON public.feed_events;
DROP FUNCTION IF EXISTS public.tg_feed_events_viewer_count();

DROP FUNCTION IF EXISTS public.feed_candidates(text, text[], int, int, int, int);
DROP FUNCTION IF EXISTS public.feed_rank_score(uuid, int, text);
DROP FUNCTION IF EXISTS public.refresh_viewer_buckets();

DROP INDEX IF EXISTS public.idx_posts_rand_public;
DROP INDEX IF EXISTS public.idx_posts_is_public_created;

-- Dropped last: the indexes above are partial on is_public, so they must go first.
ALTER TABLE public.posts
  DROP COLUMN IF EXISTS viewer_bucket_stable,
  DROP COLUMN IF EXISTS viewer_count,
  DROP COLUMN IF EXISTS rand_key,
  DROP COLUMN IF EXISTS is_public;

COMMIT;
