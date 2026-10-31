-- ============================================================================
-- THE BELL CAN NOW SAY "A DELETED ACCOUNT".              (N4 part 2, 2026-08-10)
--
-- WHAT WAS WRONG
--
--   35 follow notifications point at an actor whose profile no longer exists.
--   The bell renders every one of them as "A member started following you."
--   "A member" is the wording for a DIFFERENT case — a real, present member who
--   has set neither a full name nor a handle. Two distinct facts, one sentence.
--
--   describe.ts has separated these three cases on purpose since 2026-08-01:
--
--     * no human actor at all      -> no actor phrase ("Your entry was approved.")
--     * the profile is gone        -> "A deleted account"
--     * present, but has no label  -> "A member"
--
--   The client could not reach the second one from a grouped row, because this
--   function coalesces a missing name to an EMPTY STRING. Empty string and
--   "profile is gone" are indistinguishable by the time they reach TypeScript.
--
-- WHY THE SERVER RETURNS THE FACT INSTEAD OF THE CLIENT DEDUCING IT
--
--   The client COULD infer "deleted" from "the RPC returned an empty name and
--   an empty username", and today that would be right — all 90 live profiles
--   have names. It would also quietly merge two rules that were separated
--   deliberately, and it would start lying the day one member clears their
--   name. The LEFT JOIN to public.profiles already knows the answer; this
--   migration just stops throwing it away.
--
-- WHAT CHANGED — three lines, nothing else
--   1. actors_ranked  : + (p.id IS NOT NULL) AS profile_exists
--   2. actors_top     : + array_agg(ar.profile_exists ORDER BY ar.rn) AS actor_known
--   3. RETURNS TABLE  : + actor_known boolean[], coalesced to '{}' in the SELECT
--
--   The grouping, the badge, the exclusion list, the thumbnail privacy test and
--   the ordering are byte-for-byte what 20260802170000 shipped.
--
-- WHY A DROP AND NOT A PLAIN CREATE OR REPLACE
--   Postgres refuses to change the return type of an existing function, and
--   adding a column to RETURNS TABLE is a change of return type. The SIGNATURE
--   is unchanged — still (int, text[]) — so no ambiguous overload is created and
--   every installed app keeps calling the same function it always called.
--   DROP and CREATE run in ONE transaction: there is no moment where the bell
--   calls a function that is not there.
--
-- WHY AN EXTRA RETURN COLUMN IS SAFE FOR SHIPPED BUILDS
--   supabase-js hands the caller a JSON object. A build that does not know
--   about actor_known simply never reads that key. Builds 1055-1059 are
--   unaffected; they keep rendering exactly what they render today.
--
-- ROLLBACK: re-run 20260802170000_bell_excludes_duplicated_types.sql, which
--   drops the two-argument function first. The client line is inert without
--   this column (undefined -> today's wording), so the order does not matter.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_my_unread_notifications_grouped(int, text[]);

CREATE FUNCTION public.get_my_unread_notifications_grouped(
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
  -- TRUE  = the profile is there.
  -- FALSE = we looked and it is gone -> the display says "A deleted account".
  -- Positionally aligned with actor_ids, same ORDER BY rn as every other array.
  actor_known      boolean[],
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
         p.full_name, p.custom_url, p.avatar_url,
         -- The LEFT JOIN below already answers "is this person still here".
         -- Until now the answer was thrown away and the client had to guess.
         (p.id IS NOT NULL) AS profile_exists
    FROM actors a LEFT JOIN public.profiles p ON p.id = a.actor_id
),
actors_top AS (
  SELECT ar.gkey,
         array_agg(ar.actor_id ORDER BY ar.rn) AS actor_ids,
         array_agg(coalesce(ar.full_name,'') ORDER BY ar.rn) AS actor_names,
         array_agg(coalesce(ar.custom_url,'') ORDER BY ar.rn) AS actor_usernames,
         array_agg(coalesce(ar.avatar_url,'') ORDER BY ar.rn) AS actor_avatars,
         array_agg(ar.profile_exists ORDER BY ar.rn) AS actor_known
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
       coalesce(t.actor_known,'{}'::boolean[]) AS actor_known,
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
  'Unread notifications for the calling user, grouped by notif_group_key(). total_unread is the true count of unread rows MINUS any type in _exclude_types -- the bell passes friend_request because it already renders those from the friendships table with Accept/Decline buttons, and counting both made every pending request count twice. actor_known[i] is FALSE when actor_ids[i] has no row in profiles, which is what lets the bell say "A deleted account" instead of "A member" -- two different facts that shared one sentence until 2026-08-10.';
