-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261018_0001 — S12-F1 Signals + Hide + Mute
-- Lanes: staging and production (refuses any other lane).
--
-- 20261018_0001 created only new objects, so the pre-state is their absence:
--   * the cron job purge-feed-signals is unscheduled;
--   * the five tables are dropped (their policies, triggers, indexes and FKs
--     go with them) — feed_signal_events, feed_post_signals, feed_author_signals,
--     feed_hidden_posts, feed_muted_authors;
--   * the four functions are dropped.
-- Nothing existing was altered by the migration, so nothing is restored.
--
-- ⚠ DATA. Every recorded signal, hide and mute is deleted. That is the point of a rollback of
-- an EXPAND step, but say so before running it on production once F2 reads them.
--
-- CLIENT IMPACT: a client that sends signals gets 404 (PGRST205, table not in
-- the schema cache) for feed_signal_events; the outbox treats it as final and
-- drops the batch, OutboxBridge logs DB-3009, nothing is shown to the member
-- and nothing else in the outbox waits for it (feed_signals is UNORDERED).
-- A queued hide / mute / unmute gets the same final 404: the outbox drops it
-- and OutboxBridge shows "1 action couldn't be sent" (no UI sends them yet).
--
-- RB-PRE-001 refuses unless 20261018_0001's post-state is present, so this
-- cannot run before the migration or twice. RB-POST-001 proves the absence.
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
  -- RB-PRE-001 · 20261018_0001's post-state.
  IF to_regclass('public.feed_signal_events') IS NULL
     OR to_regclass('public.feed_post_signals') IS NULL
     OR to_regclass('public.feed_author_signals') IS NULL
     OR to_regclass('public.feed_hidden_posts') IS NULL
     OR to_regclass('public.feed_muted_authors') IS NULL
     OR to_regprocedure('public.feed_hidden_posts_before()') IS NULL
     OR to_regprocedure('public.feed_signal_events_before()') IS NULL
     OR to_regprocedure('public.feed_signal_events_fold()') IS NULL
     OR to_regprocedure('public.purge_feed_signals(integer)') IS NULL THEN
    RAISE EXCEPTION 'S12F1-0001-RB-PRE-001: 20261018_0001''s objects are not all present — nothing to roll back, or it was changed by hand'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-feed-signals';

DROP TABLE public.feed_signal_events;
DROP TABLE public.feed_post_signals;
DROP TABLE public.feed_author_signals;
DROP TABLE public.feed_hidden_posts;
DROP TABLE public.feed_muted_authors;
DROP FUNCTION public.feed_signal_events_before();
DROP FUNCTION public.feed_signal_events_fold();
DROP FUNCTION public.feed_hidden_posts_before();
DROP FUNCTION public.purge_feed_signals(integer);

DO $rb_postconditions$
BEGIN
  -- RB-POST-001 · every S12-F1 object is gone.
  IF to_regclass('public.feed_signal_events') IS NOT NULL
     OR to_regclass('public.feed_post_signals') IS NOT NULL
     OR to_regclass('public.feed_author_signals') IS NOT NULL
     OR to_regclass('public.feed_hidden_posts') IS NOT NULL
     OR to_regclass('public.feed_muted_authors') IS NOT NULL
     OR to_regproc('public.feed_hidden_posts_before') IS NOT NULL
     OR to_regproc('public.feed_signal_events_before') IS NOT NULL
     OR to_regproc('public.feed_signal_events_fold') IS NOT NULL
     OR to_regproc('public.purge_feed_signals') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-feed-signals') THEN
    RAISE EXCEPTION 'S12F1-0001-RB-POST-001: an S12-F1 object is still present' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F1-0001 ROLLBACK: signals, hide and mute tables, functions and the purge job removed';
END
$rb_postconditions$;

COMMIT;
