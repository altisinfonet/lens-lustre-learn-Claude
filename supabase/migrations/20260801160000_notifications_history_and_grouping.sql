-- ============================================================================
-- NOTIFICATIONS: history + server-side grouping  (owner request 2026-08-01)
--
-- WHY
--   The notification list was an UNREAD INBOX, not a history:
--   useNotificationsQuery filtered `.eq("is_read", false)` and capped at 30, so
--   a notification disappeared forever the moment it was read or dismissed.
--   The owner asked for an Instagram-style screen — "Highlights / Last 30 days",
--   grouped rows ("X, Y and others shared 33 photos"), thumbnails, relative
--   time — which is a HISTORY. See NOTIFICATIONS_REBUILD_SPEC.md.
--
-- WHAT THIS ADDS  (nothing is dropped, altered or deleted)
--   1. An index that makes a history query possible at all. The only existing
--      index is idx_user_notif_user_read ... WHERE is_read = false — a PARTIAL
--      index. The moment the is_read filter goes away it stops applying and the
--      query degrades to a scan of the table per user. At 911 rows nobody would
--      notice; at ~308 new rows/day it would bite. Hence (user_id, created_at DESC).
--
--   2. get_my_notifications_grouped() — one read-side RPC that does the grouping
--      in ONE place, so web and app can never drift apart on what "and others"
--      means. The raw table stays exactly as simple as it is today.
--
-- GROUPING RULE
--   Only "noisy" types collapse, and only within the same calendar day:
--     post_reaction, image_reaction, post_comment, image_comment,
--     comment_reply, new_post_from_following
--   Everything else stays one row per event, because those rows carry an
--   action the user must be able to take individually (friend_request needs
--   Accept/Decline; new_follower needs Follow back; a competition result is
--   not something to bundle with anything else).
--
-- PRIVACY
--   SECURITY DEFINER, so it is written to be paranoid:
--     * hard-filtered to n.user_id = auth.uid(), and returns nothing at all when
--       auth.uid() IS NULL — an anonymous caller gets zero rows, not everyone's.
--     * the thumbnail is exposed ONLY for a public post or the caller's own
--       post. A private/friends-only photo never leaks a preview through here.
--     * actor names come back RAW (full_name / custom_url). The admin-brand
--       renaming stays in the client (resolveName + adminBrand), which is where
--       it already lives — this function does not second-guess it.
--
-- SCALE NOTE (deliberate, not an oversight)
--   Grouping runs over all of the caller's rows older than _before rather than
--   over a pre-sliced window, because slicing rows before grouping makes page
--   boundaries split a group in half. The heaviest single user today has a few
--   hundred rows. Revisit if any one user passes ~5,000: at that point group in
--   a materialised view instead of per request.
-- ============================================================================

-- 1. The index a history query needs.
CREATE INDEX IF NOT EXISTS idx_user_notif_user_created
  ON public.user_notifications (user_id, created_at DESC);

-- 2. The grouped read.
CREATE OR REPLACE FUNCTION public.get_my_notifications_grouped(
  _limit  int         DEFAULT 30,
  _before timestamptz DEFAULT NULL
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
  latest_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
WITH mine AS (
  SELECT n.id,
         n.type,
         n.title,
         n.message,
         n.reference_id,
         n.actor_id,
         n.is_read,
         n.created_at,
         CASE
           WHEN n.type IN ('post_reaction','image_reaction','post_comment',
                           'image_comment','comment_reply','new_post_from_following')
             THEN n.type || '|' || to_char(date_trunc('day', n.created_at), 'YYYY-MM-DD')
           ELSE n.type || '|' || n.id::text          -- never grouped: unique key
         END AS gkey
    FROM public.user_notifications n
   WHERE auth.uid() IS NOT NULL
     AND n.user_id = auth.uid()
     AND (_before IS NULL OR n.created_at < _before)
),
-- one entry per (group, actor), carrying that actor's most recent event
actors AS (
  SELECT m.gkey, m.actor_id, max(m.created_at) AS last_at
    FROM mine m
   WHERE m.actor_id IS NOT NULL
   GROUP BY m.gkey, m.actor_id
),
actors_ranked AS (
  SELECT a.gkey,
         a.actor_id,
         row_number() OVER (PARTITION BY a.gkey ORDER BY a.last_at DESC, a.actor_id) AS rn,
         p.full_name,
         p.custom_url,
         p.avatar_url
    FROM actors a
    LEFT JOIN public.profiles p ON p.id = a.actor_id
),
-- the 3 most recent actors are enough to render "A, B and 31 others"
actors_top AS (
  SELECT ar.gkey,
         array_agg(ar.actor_id                    ORDER BY ar.rn) AS actor_ids,
         array_agg(coalesce(ar.full_name,  '')    ORDER BY ar.rn) AS actor_names,
         array_agg(coalesce(ar.custom_url, '')    ORDER BY ar.rn) AS actor_usernames,
         array_agg(coalesce(ar.avatar_url, '')    ORDER BY ar.rn) AS actor_avatars
    FROM actors_ranked ar
   WHERE ar.rn <= 3
   GROUP BY ar.gkey
),
grouped AS (
  SELECT m.gkey,
         min(m.type)                                          AS type,
         max(m.created_at)                                    AS latest_at,
         count(*)::int                                        AS event_count,
         count(*) FILTER (WHERE NOT m.is_read)::int           AS unread_count,
         count(DISTINCT m.actor_id)::int                      AS actor_count,
         (array_agg(m.id ORDER BY m.created_at DESC))[1:100]  AS notification_ids
    FROM mine m
   GROUP BY m.gkey
),
-- title/message/reference_id come from the newest event in the group
latest AS (
  SELECT DISTINCT ON (m.gkey)
         m.gkey, m.title, m.message, m.reference_id
    FROM mine m
   ORDER BY m.gkey, m.created_at DESC, m.id
)
SELECT g.gkey                                        AS group_key,
       g.type,
       g.notification_ids,
       coalesce(t.actor_ids,       '{}'::uuid[])     AS actor_ids,
       coalesce(t.actor_names,     '{}'::text[])     AS actor_names,
       coalesce(t.actor_usernames, '{}'::text[])     AS actor_usernames,
       coalesce(t.actor_avatars,   '{}'::text[])     AS actor_avatars,
       g.actor_count,
       g.event_count,
       g.unread_count,
       l.reference_id,
       -- thumbnail only when the caller is allowed to see that photo at all
       CASE WHEN p.id IS NOT NULL
                 AND (p.privacy = 'public' OR p.user_id = auth.uid())
            THEN p.image_url END                     AS thumbnail_url,
       l.title,
       l.message,
       g.latest_at
  FROM grouped g
  JOIN latest     l ON l.gkey = g.gkey
  LEFT JOIN actors_top t ON t.gkey = g.gkey
  LEFT JOIN public.posts p ON p.id = l.reference_id
 ORDER BY g.latest_at DESC
 LIMIT greatest(1, least(coalesce(_limit, 30), 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_my_notifications_grouped(int, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_my_notifications_grouped(int, timestamptz) IS
  'Grouped notification history for the calling user. Keyset-paginate by passing '
  'the previous page''s smallest latest_at as _before. Grouping rule and privacy '
  'constraints are documented in the migration that created it.';
