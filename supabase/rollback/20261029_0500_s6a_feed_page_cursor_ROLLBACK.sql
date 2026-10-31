-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261029_0500 — S6-a Feed paging by cursor
-- Lanes: staging and production (refuses any other lane).
--
-- Pre-state restored:
--   * public.get_feed_page(text, boolean, text, integer, integer, integer, text[]) dropped;
--   * public.feed_session_delivered dropped (a delivery log only — no member
--     content, nothing else reads it).
-- Nothing else was changed by 20261029_0500, so nothing else is restored.
--
-- CLIENT IMPACT: none visible. The S6-a bundle treats a missing get_feed_page
-- (PGRST202 / 42883) as "not deployed" and pages with the old
-- `_exclude_ids` calls, which this rollback does not touch.
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

DROP FUNCTION IF EXISTS public.get_feed_page(text, boolean, text, integer, integer, integer, text[]);
DROP TABLE IF EXISTS public.feed_session_delivered;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_feed_page')
     OR to_regclass('public.feed_session_delivered') IS NOT NULL THEN
    RAISE EXCEPTION 'S6A-0500-ROLLBACK-POST: get_feed_page or feed_session_delivered still exists' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S6A-0500 ROLLBACK: get_feed_page and feed_session_delivered dropped';
END
$post$;

COMMIT;
