-- Global feed stories bar: seen-state tracking + a per-viewer query that returns
-- the official account first, then followed users with active (non-expired) stories.

-- 1) Seen/unseen tracking. FK to stories + auth.users both CASCADE so this never
--    blocks story deletion or account deletion.
CREATE TABLE IF NOT EXISTS public.story_views (
  story_id  uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own story views" ON public.story_views;
CREATE POLICY "Users insert own story views" ON public.story_views
  FOR INSERT TO authenticated WITH CHECK (viewer_id = auth.uid());

DROP POLICY IF EXISTS "Users read own story views" ON public.story_views;
CREATE POLICY "Users read own story views" ON public.story_views
  FOR SELECT TO authenticated USING (viewer_id = auth.uid());

GRANT SELECT, INSERT ON public.story_views TO authenticated;

CREATE INDEX IF NOT EXISTS idx_story_views_viewer ON public.story_views(viewer_id);

-- 2) Per-viewer feed stories bar. Returns one row per user (official + people the
--    viewer follows) who has at least one active story, excluding the viewer.
--    Official is pinned first, then most-recently-updated first.
CREATE OR REPLACE FUNCTION public.get_feed_stories_bar()
 RETURNS TABLE(
   user_id uuid,
   full_name text,
   avatar_url text,
   is_official boolean,
   latest_story_at timestamptz,
   story_count integer,
   has_unseen boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  official AS (SELECT public.get_primary_admin_user_id() AS oid),
  eligible AS (
    -- the official account (always), plus everyone the viewer follows
    SELECT oid AS uid FROM official WHERE oid IS NOT NULL
    UNION
    SELECT f.following_id FROM public.follows f WHERE f.follower_id = (SELECT uid FROM me)
  ),
  active AS (
    SELECT s.user_id,
           max(s.created_at) AS latest_story_at,
           count(*)::int      AS story_count,
           bool_or(sv.story_id IS NULL) AS has_unseen
    FROM public.stories s
    JOIN eligible e ON e.uid = s.user_id
    LEFT JOIN public.story_views sv
      ON sv.story_id = s.id AND sv.viewer_id = (SELECT uid FROM me)
    WHERE s.expires_at > now()
      AND s.user_id <> (SELECT uid FROM me)   -- viewer's own stories show in the "Your Story" bubble
    GROUP BY s.user_id
  )
  SELECT a.user_id,
         p.full_name,
         p.avatar_url,
         (a.user_id = (SELECT oid FROM official)) AS is_official,
         a.latest_story_at,
         a.story_count,
         a.has_unseen
  FROM active a
  JOIN public.profiles_public_data p ON p.id = a.user_id
  ORDER BY (a.user_id = (SELECT oid FROM official)) DESC, a.latest_story_at DESC
  LIMIT 50;
$function$;

GRANT EXECUTE ON FUNCTION public.get_feed_stories_bar() TO authenticated;
