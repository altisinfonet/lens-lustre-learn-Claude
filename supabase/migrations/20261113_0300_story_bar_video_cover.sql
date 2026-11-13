-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113_0300 · the feed's story row: a VIDEO story's tile shows the video
--
-- Owner 13 Nov 2026 (screenshot: the 50mm Retina World video story's tile was
-- its profile picture): "in preview no video … like Meta does". Measured on
-- production (PROBE_20261113_0200, run 43375084687): the one live video story
-- has no picture anywhere (story image, post thumbnail, post image all NULL),
-- so cover_url was NULL and the tile fell back to the face.
--
-- A video's still frame (poster) is private: the client gets it with the same
-- play pass the player uses. So the row now also names the newest story's
-- VIDEO (cover_video_id); the tile asks for its poster. Nothing else changes:
-- same rows, same order, same visibility rule, same grants.
--
-- Rollback: supabase/rollback/20261113_0300_story_bar_video_cover_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261113_0300_story_bar_video_cover.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP FUNCTION public.get_feed_stories_bar();
CREATE FUNCTION public.get_feed_stories_bar()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, is_official boolean,
               latest_story_at timestamptz, story_count integer, has_unseen boolean, cover_url text,
               cover_video_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $fn$
  WITH me AS (SELECT auth.uid() AS uid),
  live AS (
    SELECT s.id, s.user_id, s.created_at,
           coalesce(s.image_url, p.thumbnail_url, p.image_url) AS cover,
           (SELECT pv.video_id FROM public.post_videos pv WHERE pv.post_id = s.post_id LIMIT 1) AS video_id
      FROM public.stories s
      LEFT JOIN public.posts p ON p.id = s.post_id
     WHERE s.expires_at > now()
       AND s.user_id IS DISTINCT FROM (SELECT uid FROM me)   -- own stories: the "Your Story" tile
       AND public.story_visible(s.user_id, s.post_id)
  ),
  active AS (
    SELECT l.user_id,
           max(l.created_at) AS latest_story_at,
           count(*)::int     AS story_count,
           bool_or(sv.story_id IS NULL) AS has_unseen,
           (array_agg(l.cover ORDER BY l.created_at DESC) FILTER (WHERE l.cover IS NOT NULL))[1] AS cover_url,
           (array_agg(l.video_id ORDER BY l.created_at DESC) FILTER (WHERE l.video_id IS NOT NULL))[1] AS cover_video_id
      FROM live l
      LEFT JOIN public.story_views sv ON sv.story_id = l.id AND sv.viewer_id = (SELECT uid FROM me)
     GROUP BY l.user_id
  )
  SELECT a.user_id, p.full_name, p.avatar_url,
         (a.user_id = public.get_primary_admin_user_id()) AS is_official,
         a.latest_story_at, a.story_count, a.has_unseen, a.cover_url, a.cover_video_id
    FROM active a
    JOIN public.profiles_public_data p ON p.id = a.user_id
   ORDER BY a.latest_story_at DESC
   LIMIT 100;
$fn$;
REVOKE ALL ON FUNCTION public.get_feed_stories_bar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feed_stories_bar() TO authenticated, service_role;

COMMIT;
