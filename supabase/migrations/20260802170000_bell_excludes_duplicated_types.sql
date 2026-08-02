-- ============================================================================
-- A FRIEND REQUEST STOPS COUNTING TWICE.                    (Stage 4, 2026-08-02)
--
-- WHAT WAS WRONG, measured on production before this was written
--
--   The bell fetches pending rows from `friendships` AND unread rows from
--   `user_notifications`. A friend request produces BOTH. So every pending
--   request was counted twice in the badge and rendered twice in the panel:
--   once in "Friend Requests" with Accept/Decline, and once under "Friends" as
--   a line that does nothing.
--
--   It is not approximate. Every member with pending requests has exactly as
--   many unread friend_request notifications:
--
--     pending 3 / unread friend_request notifications 3
--     pending 3 / unread friend_request notifications 3
--     pending 3 / unread friend_request notifications 3
--     pending 3 / unread friend_request notifications 3
--     pending 3 / unread friend_request notifications 4
--
--   (The last member has one extra because a request was accepted and the
--   notification was never marked read -- 14 rows platform-wide are in that
--   state. The client change shipping with this migration fixes that going
--   forward; no historical row is touched.)
--
-- WHY THE FIX IS SERVER-SIDE
--   The badge is `total_unread`, counted inside the RPC. Filtering the list in
--   the client would leave the number wrong -- the exact bug Stage 3c was about.
--   The exclusion therefore has to happen where the counting happens.
--
-- WHY A PARAMETER RATHER THAN A HARDCODED EXCLUSION
--   /notifications is a HISTORY and must still show friend requests; only the
--   bell has the duplicate. Same function, different caller, different argument.
--
-- NOTE ON THE DROP
--   Postgres treats f(int) and f(int, text[]) as two different functions, and a
--   call passing only _limit would then be ambiguous. The old one is dropped
--   first. During the window between this migration and the client deploy, the
--   live client calls with _limit alone, which resolves to this function with
--   _exclude_types defaulting to '{}' -- i.e. exactly today's behaviour. There
--   is no broken moment.
--
-- ROLLBACK: re-run 20260802140000_bell_unread_grouped.sql (drop this one first).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_my_unread_notifications_grouped(int);

CREATE OR REPLACE FUNCTION public.get_my_unread_notifications_grouped(
  _limit         int    DEFAULT 20,
  _exclude_types text[] DEFAULT '{}'
)
RETURNS TABLE (
  group_key        text,
  type             text,
  notification_ids uuid[],
  actor_ids        uuid[],
  actor_names      text[],
  actor_usernames  text[],
  actor_avatars    text[],
  actor_count      int,
  event_count      int,
  unread_count     int,
  reference_id     uuid,
  thumbnail_url    text,
  title            text,
  message          text,
  latest_at        timestamptz,
  total_unread     int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
WITH mine AS (
  SELECT n.id, n.type, n.title, n.message, n.reference_id, n.actor_id, n.created_at,
         public.notif_group_key(n.type, n.created_at, n.id) AS gkey
    FROM public.user_notifications n
   WHERE auth.uid() IS NOT NULL
     AND n.user_id = auth.uid()
     AND n.is_read = false
     -- '{}' excludes nothing: `x = ANY('{}')` is false, so NOT false lets
     -- every row through. A caller that passes nothing gets the old behaviour.
     AND NOT (n.type = ANY(coalesce(_exclude_types, '{}')))
),
actors AS (
  SELECT m.gkey, m.actor_id, max(m.created_at) AS last_at
    FROM mine m WHERE m.actor_id IS NOT NULL GROUP BY m.gkey, m.actor_id
),
actors_ranked AS (
  SELECT a.gkey, a.actor_id,
         row_number() OVER (PARTITION BY a.gkey ORDER BY a.last_at DESC, a.actor_id) AS rn,
         p.full_name, p.custom_url, p.avatar_url
    FROM actors a LEFT JOIN public.profiles p ON p.id = a.actor_id
),
actors_top AS (
  SELECT ar.gkey,
         array_agg(ar.actor_id ORDER BY ar.rn) AS actor_ids,
         array_agg(coalesce(ar.full_name,'') ORDER BY ar.rn) AS actor_names,
         array_agg(coalesce(ar.custom_url,'') ORDER BY ar.rn) AS actor_usernames,
         array_agg(coalesce(ar.avatar_url,'') ORDER BY ar.rn) AS actor_avatars
    FROM actors_ranked ar WHERE ar.rn <= 3 GROUP BY ar.gkey
),
grouped AS (
  SELECT m.gkey, min(m.type) AS type, max(m.created_at) AS latest_at,
         count(*)::int AS event_count,
         count(DISTINCT m.actor_id)::int AS actor_count,
         (array_agg(m.id ORDER BY m.created_at DESC))[1:100] AS notification_ids
    FROM mine m GROUP BY m.gkey
),
latest AS (
  SELECT DISTINCT ON (m.gkey) m.gkey, m.title, m.message, m.reference_id
    FROM mine m ORDER BY m.gkey, m.created_at DESC, m.id
)
SELECT g.gkey AS group_key, g.type, g.notification_ids,
       coalesce(t.actor_ids,'{}'::uuid[]) AS actor_ids,
       coalesce(t.actor_names,'{}'::text[]) AS actor_names,
       coalesce(t.actor_usernames,'{}'::text[]) AS actor_usernames,
       coalesce(t.actor_avatars,'{}'::text[]) AS actor_avatars,
       g.actor_count, g.event_count, g.event_count AS unread_count, l.reference_id,
       CASE WHEN p.id IS NOT NULL AND (p.privacy = 'public' OR p.user_id = auth.uid())
            THEN p.image_url END AS thumbnail_url,
       l.title, l.message, g.latest_at,
       -- The badge. Excluded types are left out HERE too, which is the point:
       -- a number that disagrees with the list under it is how this started.
       (SELECT count(*)::int FROM public.user_notifications u
         WHERE u.user_id = auth.uid()
           AND u.is_read = false
           AND NOT (u.type = ANY(coalesce(_exclude_types, '{}')))) AS total_unread
  FROM grouped g
  JOIN latest l ON l.gkey = g.gkey
  LEFT JOIN actors_top t ON t.gkey = g.gkey
  LEFT JOIN public.posts p ON p.id = l.reference_id
 ORDER BY g.latest_at DESC
 LIMIT greatest(1, least(coalesce(_limit, 20), 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_my_unread_notifications_grouped(int, text[]) TO authenticated;

COMMENT ON FUNCTION public.get_my_unread_notifications_grouped(int, text[]) IS
  'Unread notifications for the calling user, grouped by notif_group_key(). total_unread is the true count of unread rows MINUS any type in _exclude_types -- the bell passes friend_request because it already renders those from the friendships table with Accept/Decline buttons, and counting both made every pending request count twice.';
