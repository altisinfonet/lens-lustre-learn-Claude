-- ROLLBACK · 20261111_0100 stories v2. Restores the stories bar, the two
-- stories policies and the bell wording as they were; drops likes, story
-- comments (THEIR ROWS ARE LOST), post stories (rows with post_id are deleted:
-- they cannot exist under the old NOT NULL image_url rule without a photo) and
-- the highlight link. Plain stories, views and highlights are kept.
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stories-cleanup') THEN
    PERFORM cron.unschedule('stories-cleanup');
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.story_cleanup();
DROP FUNCTION IF EXISTS public.story_comments_list(uuid, integer);
DROP FUNCTION IF EXISTS public.story_add_post(uuid);
DROP FUNCTION IF EXISTS public.get_user_stories(uuid);

DROP TRIGGER IF EXISTS trg_highlight_items_own_story ON public.highlight_items;
DROP FUNCTION IF EXISTS public.highlight_items_own_story();
ALTER TABLE public.highlight_items DROP COLUMN IF EXISTS story_id;

DROP TABLE IF EXISTS public.story_comments;
DROP FUNCTION IF EXISTS public.story_comment_notify();
DROP FUNCTION IF EXISTS public.story_comments_rate_limit();
DROP TABLE IF EXISTS public.story_likes;
DELETE FROM public.notification_types WHERE type = 'story_comment';

CREATE OR REPLACE FUNCTION public.notif_action_phrase(_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _type
           WHEN 'new_post_from_following' THEN 'shared a photo.'
           WHEN 'post_reaction'           THEN 'reacted to your photo.'
           WHEN 'image_reaction'          THEN 'reacted to your photo.'
           WHEN 'post_comment'            THEN 'commented on your photo.'
           WHEN 'image_comment'           THEN 'commented on your photo.'
           WHEN 'comment_reply'           THEN 'replied to your comment.'
           WHEN 'new_follower'            THEN 'started following you.'
           WHEN 'friend_request'          THEN 'sent you a friend request.'
           WHEN 'friend_accepted'         THEN 'accepted your friend request.'
           WHEN 'post_tag'                THEN 'tagged you in a photo.'
           WHEN 'tagged_post_reaction'    THEN 'reacted to a photo you are tagged in.'
           WHEN 'tagged_post_comment'     THEN 'commented on a photo you are tagged in.'
           WHEN 'ad_comment_reply'        THEN 'replied to your comment on a sponsored post.'
           ELSE NULL
         END;
$function$;

CREATE OR REPLACE FUNCTION public.notif_group_key(_type text, _created_at timestamp with time zone, _id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
           WHEN _type IN ('post_reaction','image_reaction','post_comment',
                          'image_comment','comment_reply','new_post_from_following',
                          'tagged_post_reaction','tagged_post_comment',
                          'ad_comment_reply')
             THEN _type || '|' || to_char(date_trunc('day', _created_at), 'YYYY-MM-DD')
           ELSE _type || '|' || _id::text          -- never grouped: unique key
         END;
$function$;

-- stories: back to the old shape
DROP POLICY IF EXISTS "View live stories the viewer may see" ON public.stories;
CREATE POLICY "Anyone can view non-expired stories" ON public.stories FOR SELECT USING (expires_at > now());
DROP POLICY IF EXISTS "Users can create own stories" ON public.stories;
CREATE POLICY "Users can create own stories" ON public.stories
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) AND (NOT public.is_banned((SELECT auth.uid()))));

DROP FUNCTION IF EXISTS public.get_feed_stories_bar();
CREATE FUNCTION public.get_feed_stories_bar()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, is_official boolean, latest_story_at timestamp with time zone, story_count integer, has_unseen boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  official AS (SELECT public.get_primary_admin_user_id() AS oid),
  active AS (
    SELECT s.user_id,
           max(s.created_at) AS latest_story_at,
           count(*)::int      AS story_count,
           bool_or(sv.story_id IS NULL) AS has_unseen
    FROM public.stories s
    LEFT JOIN public.story_views sv
      ON sv.story_id = s.id AND sv.viewer_id = (SELECT uid FROM me)
    WHERE s.expires_at > now()
      AND s.user_id <> (SELECT uid FROM me)
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
  ORDER BY a.latest_story_at DESC
  LIMIT 100;
$function$;
REVOKE ALL ON FUNCTION public.get_feed_stories_bar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feed_stories_bar() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.story_visible(uuid, uuid);
DELETE FROM public.stories WHERE post_id IS NOT NULL;
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_has_media;
DROP INDEX IF EXISTS public.stories_post_id_key;
ALTER TABLE public.stories DROP COLUMN IF EXISTS post_id;
ALTER TABLE public.stories ALTER COLUMN image_url SET NOT NULL;

DO $post$
BEGIN
  IF to_regclass('public.story_comments') IS NOT NULL OR to_regclass('public.story_likes') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'stories' AND column_name = 'post_id') THEN
    RAISE EXCEPTION 'ST-0100-RB: a v2 object is still there';
  END IF;
  RAISE NOTICE 'ST-0100 rolled back on %', current_setting('p32.lane');
END
$post$;

COMMIT;
