-- ============================================================================
-- NOTIFICATIONS stage 3: "someone you follow just shared a post"
--                        (owner request 2026-08-01)
--
-- WHY
--   The owner's reference screenshot shows "somnath_photolover22 just shared a
--   post" and "aninditahidayat, vickyroy87 and others shared 33 photos". Those
--   never arrived because the TYPE DID NOT EXIST. Nothing in the codebase or the
--   database ever created one, so there was nothing to deliver. This adds the
--   write side. The read side (grouping, sentence, screen) already handles the
--   type — see 20260801160000 and src/lib/notificationText.ts.
--
-- OWNER DECISION, 2026-08-01: IN-APP ONLY, AGGREGATED. NO PUSH.
--   Everyone on this platform follows nearly everyone, so pushing every post to
--   every follower is the fastest possible route to a muted app. The rows are
--   created so the notification screen shows them; the phone stays quiet.
--
--   ⚠ This needed real care. push_on_notification()'s preference CASE ends in
--   `ELSE true`, so a BRAND NEW TYPE PUSHES BY DEFAULT. Simply inserting rows
--   would have pushed every post to every follower — the exact opposite of what
--   was asked for. The new type is therefore added as the FIRST branch of that
--   CASE, before the `np.user_id IS NULL THEN true` fallback, and reads a new
--   column that defaults to false. coalesce(...,false) covers users who have no
--   preferences row at all.
--
-- SWITCHABLE LATER WITHOUT CODE
--   notification_preferences.push_new_posts defaults to false. Flipping it to
--   true for a user turns pushes on for them. No migration, no deploy.
--
-- VOLUME GUARDS
--   * public posts only — a private or friends-only post fans out to nobody
--   * the author never notifies themselves
--   * hard cap of 1000 followers per post, logged when hit, so a future large
--     account cannot write an unbounded number of rows inside one INSERT
--   * one row per (follower, post) — so "shared 33 photos" counts 33 REAL posts.
--     Collapsing at write time would have made that number a fiction, and the
--     read-side RPC already groups by day.
--
-- SAFETY
--   The fan-out can never break posting: it is AFTER INSERT, and its exception
--   handler RAISE LOGs and returns instead of re-raising. It logs loudly on
--   purpose — a silent EXCEPTION WHEN OTHERS is exactly how push stayed broken
--   from launch until 2026-08-01 (PROJECT_MASTER_RECORD §0).
--
-- Also fixes a gap found while writing this: the notification thumbnail read
-- only posts.image_url, but posts now also carry image_urls text[] (multi-image
-- posts). A multi-image post would have shown no thumbnail.
-- ============================================================================

-- 1. Per-user switch. Default FALSE = in-app only, as instructed.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_new_posts boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.notification_preferences.push_new_posts IS
  'Push a phone notification when someone you follow posts. Default FALSE '
  '(owner decision 2026-08-01: in-app only). The row is still created and shown '
  'in the notification list regardless of this flag.';

-- 2. Teach the push trigger about the new type BEFORE its ELSE true fallback.
CREATE OR REPLACE FUNCTION public.push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _cfg   public.push_config%ROWTYPE;
  _allow boolean := true;
BEGIN
  SELECT * INTO _cfg FROM public.push_config WHERE id LIMIT 1;
  IF _cfg.function_url IS NULL THEN
    RETURN NEW;  -- not configured yet: notification still saved, no push
  END IF;

  -- Never push to the person who caused the event.
  IF NEW.actor_id IS NOT NULL AND NEW.actor_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT CASE
           -- MUST stay first: a missing preferences row must NOT fall through to
           -- `WHEN np.user_id IS NULL THEN true` for this high-volume type.
           WHEN NEW.type = 'new_post_from_following'
             THEN coalesce(np.push_new_posts, false)
           WHEN np.user_id IS NULL THEN true
           WHEN np.push_enabled = false THEN false
           WHEN NEW.type IN ('post_reaction','image_reaction')            THEN np.push_reactions
           WHEN NEW.type IN ('post_comment','image_comment','comment_reply') THEN np.push_comments
           WHEN NEW.type = 'friend_request'                                THEN np.push_friend_requests
           WHEN NEW.type = 'new_follower'                                  THEN np.push_new_followers
           WHEN NEW.type IN ('competition_vote','entry_approved','entry_rejected',
                             'competition_winner','new_competition')       THEN np.push_competition_updates
           ELSE true
         END
    INTO _allow
  FROM (SELECT 1) AS _one
  LEFT JOIN public.notification_preferences np ON np.user_id = NEW.user_id;

  IF _allow IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := _cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-internal-secret', _cfg.internal_secret
               ),
    body    := jsonb_build_object(
                 'user_id', NEW.user_id,
                 'title',   NEW.title,
                 'body',    COALESCE(NEW.message, ''),
                 'data',    jsonb_build_object(
                              'type', NEW.type,
                              'reference_id', COALESCE(NEW.reference_id::text, '')
                            )
               )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'push_on_notification failed for user % : % / %', NEW.user_id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$fn$;

-- 3. The fan-out itself.
CREATE OR REPLACE FUNCTION public.fan_out_new_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _followers int;
  _cap       constant int := 1000;
BEGIN
  -- Public posts only. A private or friends-only photo notifies nobody.
  IF NEW.privacy IS DISTINCT FROM 'public' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _followers
    FROM public.follows f
   WHERE f.following_id = NEW.user_id
     AND f.follower_id <> NEW.user_id;

  IF _followers = 0 THEN
    RETURN NEW;
  END IF;

  IF _followers > _cap THEN
    RAISE LOG 'fan_out_new_post: author % has % followers, capping notification fan-out at %',
              NEW.user_id, _followers, _cap;
  END IF;

  INSERT INTO public.user_notifications (user_id, type, title, message, reference_id, actor_id)
  SELECT f.follower_id,
         'new_post_from_following',
         'New post',
         'just shared a post',
         NEW.id,
         NEW.user_id
    FROM public.follows f
   WHERE f.following_id = NEW.user_id
     AND f.follower_id <> NEW.user_id
   ORDER BY f.created_at DESC
   LIMIT _cap;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Posting must never fail because notifications failed. But it must not be
  -- silent either -- that is how push stayed broken from launch to 2026-08-01.
  RAISE LOG 'fan_out_new_post failed for post % by % : % / %',
            NEW.id, NEW.user_id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fan_out_new_post ON public.posts;
CREATE TRIGGER trg_fan_out_new_post
  AFTER INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.fan_out_new_post();

-- Fan-out reads follows by the person being followed.
CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows (following_id);

-- 4. Thumbnail gap: posts now also carry image_urls text[] (multi-image posts),
--    and the notification read only image_url, so a multi-image post showed no
--    thumbnail at all. Same function as 20260801160000, one line changed.
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
         CASE
           WHEN n.type IN ('post_reaction','image_reaction','post_comment',
                           'image_comment','comment_reply','new_post_from_following')
             THEN n.type || '|' || to_char(date_trunc('day', n.created_at), 'YYYY-MM-DD')
           ELSE n.type || '|' || n.id::text
         END AS gkey
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
            -- multi-image posts store their photos in image_urls
            THEN coalesce(p.image_url, p.image_urls[1]) END   AS thumbnail_url,
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
