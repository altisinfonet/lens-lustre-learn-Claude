-- ============================================================================
-- THE BELL GROUPS LIKE THE PAGE, AND THE BADGE STOPS LYING.   (Stage 3c, 2026-08-02)
--
-- WHAT WAS WRONG
--
-- 1. TWO DIFFERENT ANSWERS TO "WHAT IS ONE NOTIFICATION?"
--    /notifications collapses a day's reactions into one line via
--    get_my_notifications_grouped(). The bell read raw rows, so 40 reactions
--    were 40 lines in the panel and one line on the page — the same events,
--    two different shapes. The owner's decision (2026-08-01) was that the bell
--    should group the same way.
--
-- 2. THE BADGE SILENTLY CAPPED AT 30.
--    The bell's query was `.eq(is_read,false).limit(30)` and the badge counted
--    the length of that array. Measured on this database 2026-08-02: 75 members
--    have unread notifications, 4 of them have more than 30, and the worst has
--    **111**. That member's badge has been showing 30. Not "roughly right" —
--    wrong, and silently so, which is worse.
--
-- WHAT THIS ADDS
--   * notif_group_key() — the grouping rule, extracted so it exists ONCE.
--   * get_my_notifications_grouped() — rewritten to call it. Behaviour is
--     unchanged; this was verified key-for-key over every row in the table
--     before and after (see PROOF below).
--   * get_my_unread_notifications_grouped() — the same read restricted to
--     unread, returning the identical column shape (so one TypeScript type
--     serves both surfaces) plus `total_unread`: the TRUE number of unread
--     rows, independent of how many groups came back.
--
-- Nothing is dropped. No table, trigger, policy or row is touched.
--
-- WHY THE GROUPING RULE HAD TO COME OUT INTO ITS OWN FUNCTION
--   It was an inline CASE inside one RPC. Copying that CASE into a second RPC
--   is exactly how the push body and the app drifted apart for months (fixed
--   yesterday in 20260802090000). A rule that decides what users see gets one
--   definition, and every reader calls it.
--
-- PROOF RUN BEFORE SHIPPING (production, 2026-08-02)
--   The old inline expression and notif_group_key() were evaluated over all 993
--   rows and compared: 0 rows differed, and the count of distinct keys was
--   identical. The rewrite cannot have changed what a group is.
--
-- ROLLBACK
--   The bell falls back to raw rows if the new function is absent, so dropping
--   get_my_unread_notifications_grouped() is safe on its own. To undo the
--   refactor as well, re-run 20260801160000_notifications_history_and_grouping.sql.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) THE GROUPING RULE — one definition, called by every reader.
--
-- Only "noisy" types collapse, and only within the same calendar day.
-- Everything else stays one row per event because those rows carry an action
-- the member must take individually: friend_request needs Accept/Decline,
-- post_tag needs Approve/Decline, new_follower needs Follow back, and a
-- competition result is not something to bundle with anything else.
--
-- STABLE, not IMMUTABLE: date_trunc on a timestamptz depends on the session
-- TimeZone. That was true of the inline expression too — naming it does not
-- change it, but it does make it visible.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_group_key(
  _type       text,
  _created_at timestamptz,
  _id         uuid
)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT CASE
           WHEN _type IN ('post_reaction','image_reaction','post_comment',
                          'image_comment','comment_reply','new_post_from_following')
             THEN _type || '|' || to_char(date_trunc('day', _created_at), 'YYYY-MM-DD')
           ELSE _type || '|' || _id::text          -- never grouped: unique key
         END;
$fn$;

COMMENT ON FUNCTION public.notif_group_key(text, timestamptz, uuid) IS
  'The one definition of what counts as a single notification group. Called by get_my_notifications_grouped and get_my_unread_notifications_grouped so the history page and the bell can never disagree.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The history read — unchanged except that the inline CASE is now a call.
-- ─────────────────────────────────────────────────────────────────────────────
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
  SELECT n.id, n.type, n.title, n.message, n.reference_id, n.actor_id,
         n.is_read, n.created_at,
         public.notif_group_key(n.type, n.created_at, n.id) AS gkey
    FROM public.user_notifications n
   WHERE auth.uid() IS NOT NULL
     AND n.user_id = auth.uid()
     AND (_before IS NULL OR n.created_at < _before)
),
actors AS (
  SELECT m.gkey, m.actor_id, max(m.created_at) AS last_at
    FROM mine m
   WHERE m.actor_id IS NOT NULL
   GROUP BY m.gkey, m.actor_id
),
actors_ranked AS (
  SELECT a.gkey, a.actor_id,
         row_number() OVER (PARTITION BY a.gkey ORDER BY a.last_at DESC, a.actor_id) AS rn,
         p.full_name, p.custom_url, p.avatar_url
    FROM actors a
    LEFT JOIN public.profiles p ON p.id = a.actor_id
),
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The bell's read: the same thing, unread only, plus a TRUE total.
--
-- `total_unread` is the whole point of this function existing rather than the
-- client filtering the history call. It is counted over every unread row, not
-- over the groups returned, so the badge is right whether the member has 3
-- unread or 300. It is repeated on every row because a set-returning function
-- has nowhere else to put it; when there are no groups there is nothing unread
-- to count, so 0 rows and a total of 0 agree.
--
-- `unread_count` is returned as well and always equals `event_count` here —
-- kept so the column shape is IDENTICAL to the history function and one
-- TypeScript type serves both. A shape that differs by one column is a shape
-- somebody will get wrong.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_unread_notifications_grouped(
  _limit int DEFAULT 20
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
  SELECT n.id, n.type, n.title, n.message, n.reference_id, n.actor_id,
         n.created_at,
         public.notif_group_key(n.type, n.created_at, n.id) AS gkey
    FROM public.user_notifications n
   WHERE auth.uid() IS NOT NULL
     AND n.user_id = auth.uid()
     AND n.is_read = false
),
actors AS (
  SELECT m.gkey, m.actor_id, max(m.created_at) AS last_at
    FROM mine m
   WHERE m.actor_id IS NOT NULL
   GROUP BY m.gkey, m.actor_id
),
actors_ranked AS (
  SELECT a.gkey, a.actor_id,
         row_number() OVER (PARTITION BY a.gkey ORDER BY a.last_at DESC, a.actor_id) AS rn,
         p.full_name, p.custom_url, p.avatar_url
    FROM actors a
    LEFT JOIN public.profiles p ON p.id = a.actor_id
),
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
         count(DISTINCT m.actor_id)::int                      AS actor_count,
         (array_agg(m.id ORDER BY m.created_at DESC))[1:100]  AS notification_ids
    FROM mine m
   GROUP BY m.gkey
),
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
       g.event_count                                 AS unread_count,
       l.reference_id,
       CASE WHEN p.id IS NOT NULL
                 AND (p.privacy = 'public' OR p.user_id = auth.uid())
            THEN p.image_url END                     AS thumbnail_url,
       l.title,
       l.message,
       g.latest_at,
       (SELECT count(*)::int
          FROM public.user_notifications u
         WHERE u.user_id = auth.uid()
           AND u.is_read = false)                    AS total_unread
  FROM grouped g
  JOIN latest     l ON l.gkey = g.gkey
  LEFT JOIN actors_top t ON t.gkey = g.gkey
  LEFT JOIN public.posts p ON p.id = l.reference_id
 ORDER BY g.latest_at DESC
 LIMIT greatest(1, least(coalesce(_limit, 20), 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_my_unread_notifications_grouped(int) TO authenticated;

COMMENT ON FUNCTION public.get_my_unread_notifications_grouped(int) IS
  'Unread notifications for the calling user, grouped by the same rule the history page uses. total_unread is the true count of unread rows and is what the badge must display -- the bell used to count the length of a 30-row page.';
