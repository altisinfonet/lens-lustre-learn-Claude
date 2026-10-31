-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261018_0002 — S12-F2 Interest scores
-- Lanes: staging and production (refuses any other lane).
--
-- 20261018_0002 created only new objects (and five plain indexes on existing
-- tables), so the pre-state is their absence:
--   * the cron job refresh-feed-scores is unscheduled;
--   * the six tables are dropped (indexes, FKs go with them) —
--     feed_score_config, feed_score_watermarks, feed_viewer_author_affinity,
--     feed_viewer_category_interest, feed_post_quality, feed_post_quality_queue;
--   * the two functions are dropped;
--   * the five created_at indexes on post_reactions, post_comments, post_shares,
--     follows and feed_hidden_posts are dropped (they existed for the refresh
--     only; this is the unit's own index, not a C-2 index-reconciliation drop).
-- Nothing existing was altered by the migration, so nothing is restored.
--
-- ⚠ DATA. All interest scores and tuned weights are deleted. They are derived
-- data: re-applying 20261018_0002 rebuilds them from the source tables (14-day
-- backfill), but weights changed by F6 Admin since would be lost.
--
-- CLIENT IMPACT: none — no client reads these objects. A later feed RPC (F3/F4)
-- that reads them must be rolled back first; RB-PRE-002 refuses while any
-- other function's body names a score table.
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
DECLARE
  _dep text;
BEGIN
  -- RB-PRE-001 · 20261018_0002's post-state.
  IF to_regclass('public.feed_score_config') IS NULL
     OR to_regclass('public.feed_score_watermarks') IS NULL
     OR to_regclass('public.feed_viewer_author_affinity') IS NULL
     OR to_regclass('public.feed_viewer_category_interest') IS NULL
     OR to_regclass('public.feed_post_quality') IS NULL
     OR to_regclass('public.feed_post_quality_queue') IS NULL
     OR to_regclass('public.post_reactions_created_at_idx') IS NULL
     OR to_regclass('public.post_comments_created_at_idx') IS NULL
     OR to_regclass('public.post_shares_created_at_idx') IS NULL
     OR to_regclass('public.follows_created_at_idx') IS NULL
     OR to_regclass('public.feed_hidden_posts_created_at_idx') IS NULL
     OR to_regprocedure('public.feed_scores_refresh(integer)') IS NULL
     OR to_regprocedure('public.feed_score_decayed(double precision, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'S12F2-0002-RB-PRE-001: 20261018_0002''s objects are not all present — nothing to roll back, or it was changed by hand'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- RB-PRE-002 · no other function reads the score tables (a later feed RPC
  -- would break silently at its next call; roll that unit back first).
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('feed_scores_refresh', 'feed_score_decayed')
     AND p.prosrc ~ '(feed_viewer_author_affinity|feed_viewer_category_interest|feed_post_quality|feed_score_config|feed_score_watermarks)';
  IF _dep IS NOT NULL THEN
    RAISE EXCEPTION 'S12F2-0002-RB-PRE-002: these functions read the score tables — roll their unit back first: %', _dep
      USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh-feed-scores';

DROP FUNCTION public.feed_scores_refresh(integer);
DROP FUNCTION public.feed_score_decayed(double precision, timestamp with time zone);
DROP TABLE public.feed_post_quality_queue;
DROP TABLE public.feed_post_quality;
DROP TABLE public.feed_viewer_category_interest;
DROP TABLE public.feed_viewer_author_affinity;
DROP TABLE public.feed_score_watermarks;
DROP TABLE public.feed_score_config;
DROP INDEX public.post_reactions_created_at_idx;
DROP INDEX public.post_comments_created_at_idx;
DROP INDEX public.post_shares_created_at_idx;
DROP INDEX public.follows_created_at_idx;
DROP INDEX public.feed_hidden_posts_created_at_idx;

DO $rb_postconditions$
BEGIN
  -- RB-POST-001 · every S12-F2 object is gone (functions checked by name: any overload).
  IF to_regclass('public.feed_score_config') IS NOT NULL
     OR to_regclass('public.feed_score_watermarks') IS NOT NULL
     OR to_regclass('public.feed_viewer_author_affinity') IS NOT NULL
     OR to_regclass('public.feed_viewer_category_interest') IS NOT NULL
     OR to_regclass('public.feed_post_quality') IS NOT NULL
     OR to_regclass('public.feed_post_quality_queue') IS NOT NULL
     OR to_regclass('public.post_reactions_created_at_idx') IS NOT NULL
     OR to_regclass('public.post_comments_created_at_idx') IS NOT NULL
     OR to_regclass('public.post_shares_created_at_idx') IS NOT NULL
     OR to_regclass('public.follows_created_at_idx') IS NOT NULL
     OR to_regclass('public.feed_hidden_posts_created_at_idx') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname IN ('feed_scores_refresh', 'feed_score_decayed'))
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-feed-scores') THEN
    RAISE EXCEPTION 'S12F2-0002-RB-POST-001: an S12-F2 object is still present' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F2-0002 ROLLBACK: score tables, functions, created_at indexes and the refresh job removed';
END
$rb_postconditions$;

COMMIT;
