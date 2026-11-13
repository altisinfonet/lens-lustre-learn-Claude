-- ROLLBACK of 20261113_0600 (Trending this week). The card falls back to the
-- dashboard-init list it read before (the client keeps that path while
-- get_trending_week is missing). The marks history goes with the table.
BEGIN;
DROP FUNCTION IF EXISTS public.get_trending_week();
DROP FUNCTION IF EXISTS public.trending_video_clear();
DROP FUNCTION IF EXISTS public.trending_video_set(uuid);
DROP TABLE IF EXISTS public.trending_week_video;
COMMIT;
