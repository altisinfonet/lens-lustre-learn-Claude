-- ═══════════════════════════════════════════════════════════════════════════
-- Stories v2 · 20261111_0100 — one Story system: post → story, who may see a
-- story, likes, comments on the story (Facebook-Live style), highlights keep
-- a story, nightly clean-up.
-- Lanes: staging and production. Expand only: two tables, one column each on
-- stories / highlight_items, functions; two stories policies replaced.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (Owner, 6 Nov 2026, "go stories"): every post goes to the member's
-- 24-hour story unless they untick the box; a story is seen by the same people
-- as its post; replies are COMMENTS shown on the story (there is no message
-- box and none will be built); the owner gets a bell notification; comments on
-- a story made from a post are the POST's comments (they stay with the post);
-- comments on a plain story go when the story goes, unless it is in a Highlight.
--
-- OBJECTS
--   stories.post_id  uuid → posts ON DELETE CASCADE (deleting the post deletes
--     its story). One story per post (unique). image_url may now be NULL for a
--     post story whose post has no photo URL (a video post); every story still
--     has a post or a photo (CHECK stories_has_media).
--   story_visible(owner, post) — a plain story: everyone (as today); a post
--     story: whoever can view the post (can_view_post — same rule as the feed).
--   policies on stories: SELECT = live AND visible (was: live); INSERT = own
--     plain story only (post_id NULL) — a post story is made only by
--     story_add_post, which checks the caller owns the post.
--   story_likes (story_id, user_id) — RLS: add / remove your own like on a
--     live story you can see; nobody reads the table (counts via RPC).
--   story_comments — a comment on a PLAIN story. RLS: add your own on a live
--     plain story you can see. Same keyword filter as post comments
--     (enforce_comment_blocklist), 100 per hour, the owner is told through the
--     notification centre (type story_comment, group likes & comments).
--   highlight_items.story_id → stories ON DELETE SET NULL; only your own
--     story can go into your own highlight (trigger). A story in a highlight
--     is kept by the clean-up, so its comments stay.
--   RPCs (SECURITY DEFINER, search_path ''):
--     get_feed_stories_bar()          + cover_url (newest visible story's photo)
--     get_user_stories(uuid)          one member's live stories the caller may see
--     story_add_post(uuid)            the caller's post → their story (idempotent)
--     story_comments_list(uuid, int)  comments shown on a story
--     story_cleanup()                 nightly: expired > 1 day, not in a highlight
--
-- NOT RE-RUNNABLE: PRE-002 refuses once stories.post_id exists.
-- ROLLBACK: supabase/rollback/20261111_0100_stories_v2_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261111_0100_stories_v2.sql (FAIL before, PASS after)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regclass('public.stories') IS NULL OR to_regclass('public.story_views') IS NULL
     OR to_regclass('public.posts') IS NULL OR to_regclass('public.highlight_items') IS NULL
     OR to_regclass('public.highlights') IS NULL OR to_regclass('public.profiles_public_data') IS NULL
     OR to_regclass('public.notification_types') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.post_comments') IS NULL OR to_regclass('public.post_videos') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.is_banned(uuid)') IS NULL
     OR to_regprocedure('public.account_is_live()') IS NULL
     OR to_regprocedure('public.enforce_comment_blocklist()') IS NULL
     OR to_regprocedure('public.notification_centre_emit(text,uuid,uuid,uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.get_primary_admin_user_id()') IS NULL
     OR to_regprocedure('public.get_feed_stories_bar()') IS NULL
     OR to_regprocedure('public.notif_action_phrase(text)') IS NULL
     OR to_regprocedure('public.notif_group_key(text,timestamp with time zone,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ST-0100-PRE-001: a table or function this file builds on is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'stories' AND column_name = 'post_id')
     OR to_regclass('public.story_comments') IS NOT NULL OR to_regclass('public.story_likes') IS NOT NULL THEN
    RAISE EXCEPTION 'ST-0100-PRE-002: stories.post_id / story_comments / story_likes exists — 20261111_0100 is applied';
  END IF;
  -- PRE-003 · the two policies this file replaces are the ones it expects.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stories'
                  AND policyname = 'Anyone can view non-expired stories' AND cmd = 'SELECT'
                  AND qual = '(expires_at > now())')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stories'
                     AND policyname = 'Users can create own stories' AND cmd = 'INSERT') THEN
    RAISE EXCEPTION 'ST-0100-PRE-003: the stories SELECT / INSERT policies are not the expected ones — re-read them first';
  END IF;
  -- PRE-004 · the bell wording functions are the ones this file extends.
  IF position('ad_comment_reply' IN pg_get_functiondef('public.notif_action_phrase(text)'::regprocedure)) = 0
     OR position('ad_comment_reply' IN pg_get_functiondef('public.notif_group_key(text,timestamp with time zone,uuid)'::regprocedure)) = 0
     OR position('story_comment' IN pg_get_functiondef('public.notif_action_phrase(text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'ST-0100-PRE-004: notif_action_phrase / notif_group_key are not the expected bodies';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_types WHERE type = 'story_comment') THEN
    RAISE EXCEPTION 'ST-0100-PRE-005: notification type story_comment already registered';
  END IF;
END
$pre$;

-- ── 1. a story can come from a post ────────────────────────────────────────
ALTER TABLE public.stories
  ADD COLUMN post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE;
ALTER TABLE public.stories ALTER COLUMN image_url DROP NOT NULL;
ALTER TABLE public.stories
  ADD CONSTRAINT stories_has_media CHECK (post_id IS NOT NULL OR image_url IS NOT NULL);
-- one story per post; also the FK lookup for ON DELETE CASCADE
CREATE UNIQUE INDEX stories_post_id_key ON public.stories (post_id) WHERE post_id IS NOT NULL;
-- the bar and one member's stories read live rows by owner
CREATE INDEX IF NOT EXISTS stories_user_expires_idx ON public.stories (user_id, expires_at DESC);
-- the nightly clean-up reads by expiry
CREATE INDEX IF NOT EXISTS stories_expires_idx ON public.stories (expires_at);

-- ── 2. who may see a story ─────────────────────────────────────────────────
CREATE FUNCTION public.story_visible(_owner uuid, _post_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT _post_id IS NULL
      OR EXISTS (SELECT 1 FROM public.posts p
                  WHERE p.id = _post_id AND p.user_id = _owner
                    AND public.can_view_post(auth.uid(), p.user_id, p.privacy));
$fn$;
REVOKE ALL ON FUNCTION public.story_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.story_visible(uuid, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.story_visible(uuid, uuid) IS
  'Stories v2 20261111_0100: a plain story is public (as before); a post story is seen by whoever can view the post (can_view_post).';

DROP POLICY "Anyone can view non-expired stories" ON public.stories;
CREATE POLICY "View live stories the viewer may see" ON public.stories
  FOR SELECT USING (expires_at > now() AND public.story_visible(user_id, post_id));

DROP POLICY "Users can create own stories" ON public.stories;
CREATE POLICY "Users can create own stories" ON public.stories
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT public.is_banned((SELECT auth.uid())) AND post_id IS NULL);

-- ── 3. likes ───────────────────────────────────────────────────────────────
CREATE TABLE public.story_likes (
  story_id   uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
-- FK user_id → auth.users (ON DELETE CASCADE lookup)
CREATE INDEX story_likes_user_idx ON public.story_likes (user_id);
ALTER TABLE public.story_likes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.story_likes FROM PUBLIC, anon, authenticated;
GRANT INSERT, DELETE ON public.story_likes TO authenticated;
GRANT ALL ON public.story_likes TO service_role;
CREATE POLICY "Like a live story you can see" ON public.story_likes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
              AND EXISTS (SELECT 1 FROM public.stories s
                           WHERE s.id = story_id AND s.expires_at > now()
                             AND public.story_visible(s.user_id, s.post_id)));
CREATE POLICY "Remove your own like" ON public.story_likes
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Deleted accounts cannot insert" ON public.story_likes AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.account_is_live()));

-- ── 4. comments on a plain story ───────────────────────────────────────────
CREATE TABLE public.story_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id        uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content         text NOT NULL CONSTRAINT story_comments_content_check
                    CHECK (length(btrim(content)) BETWEEN 1 AND 1000),
  idempotency_key text CONSTRAINT story_comments_key_check CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_comments_user_idempotency_key UNIQUE (user_id, idempotency_key)
);
-- the list on a story, oldest → newest
CREATE INDEX story_comments_story_idx ON public.story_comments (story_id, created_at);
-- FK user_id → auth.users; also the per-hour count
CREATE INDEX story_comments_user_idx ON public.story_comments (user_id, created_at);
ALTER TABLE public.story_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.story_comments FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.story_comments TO authenticated;
GRANT ALL ON public.story_comments TO service_role;
CREATE POLICY "Comment on a live plain story you can see" ON public.story_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT public.is_banned((SELECT auth.uid()))
              AND EXISTS (SELECT 1 FROM public.stories s
                           WHERE s.id = story_id AND s.post_id IS NULL AND s.expires_at > now()
                             AND public.story_visible(s.user_id, s.post_id)));
CREATE POLICY "Deleted accounts cannot insert" ON public.story_comments AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.account_is_live()));

-- same keyword filter as post comments
CREATE TRIGGER trg_enforce_comment_blocklist BEFORE INSERT ON public.story_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_comment_blocklist();

CREATE FUNCTION public.story_comments_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF (SELECT count(*) FROM public.story_comments c
       WHERE c.user_id = NEW.user_id AND c.created_at > now() - interval '1 hour') >= 100 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 100 comments per hour' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.story_comments_rate_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_story_comments_rate_limit BEFORE INSERT ON public.story_comments
  FOR EACH ROW EXECUTE FUNCTION public.story_comments_rate_limit();

-- the owner is told through the notification centre (no direct write)
CREATE FUNCTION public.story_comment_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _owner uuid;
  _name  text;
BEGIN
  SELECT s.user_id INTO _owner FROM public.stories s WHERE s.id = NEW.story_id;
  IF _owner IS NULL OR _owner = NEW.user_id THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(p.full_name, 'Someone') INTO _name FROM public.profiles p WHERE p.id = NEW.user_id;
  PERFORM public.notification_centre_emit(
    'story_comment', _owner, NEW.user_id, NEW.story_id,
    'New Comment', coalesce(_name, 'Someone') || ' commented on your story',
    'story_comment:' || NEW.id::text);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.story_comment_notify() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_story_comment_notify AFTER INSERT ON public.story_comments
  FOR EACH ROW EXECUTE FUNCTION public.story_comment_notify();

INSERT INTO public.notification_types
  (type, audience, group_key, wording_key, icon, channels, member_can_disable,
   pref_in_app, pref_push, pref_email, group_by, dedup_window, rate_per_hour)
VALUES
  ('story_comment', 'member', 'likes_comments', 'notif.type.story_comment', 'comment', '{in_app,push}', true,
   'inapp_comments', 'push_comments', NULL, 'reference', '60 seconds', NULL);

-- ── 5. a highlight keeps its story ─────────────────────────────────────────
ALTER TABLE public.highlight_items
  ADD COLUMN story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL;
-- FK story_id → stories; also the clean-up's "is it in a highlight?"
CREATE INDEX highlight_items_story_idx ON public.highlight_items (story_id) WHERE story_id IS NOT NULL;

CREATE FUNCTION public.highlight_items_own_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.story_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.stories s JOIN public.highlights h ON h.id = NEW.highlight_id
        WHERE s.id = NEW.story_id AND s.user_id = h.user_id) THEN
    RAISE EXCEPTION 'ST-0100-001: only your own story can go into your highlight' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.highlight_items_own_story() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_highlight_items_own_story BEFORE INSERT OR UPDATE OF story_id, highlight_id ON public.highlight_items
  FOR EACH ROW EXECUTE FUNCTION public.highlight_items_own_story();

-- ── 6. bell wording: "commented on your story." ────────────────────────────
CREATE OR REPLACE FUNCTION public.notif_action_phrase(_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $fn$
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
           WHEN 'story_comment'           THEN 'commented on your story.'
           ELSE NULL
         END;
$fn$;

CREATE OR REPLACE FUNCTION public.notif_group_key(_type text, _created_at timestamp with time zone, _id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $fn$
  SELECT CASE
           WHEN _type IN ('post_reaction','image_reaction','post_comment',
                          'image_comment','comment_reply','new_post_from_following',
                          'tagged_post_reaction','tagged_post_comment',
                          'ad_comment_reply','story_comment')
             THEN _type || '|' || to_char(date_trunc('day', _created_at), 'YYYY-MM-DD')
           ELSE _type || '|' || _id::text          -- never grouped: unique key
         END;
$fn$;

-- ── 7. the feed's story row: + the newest visible story's photo ────────────
DROP FUNCTION public.get_feed_stories_bar();
CREATE FUNCTION public.get_feed_stories_bar()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, is_official boolean,
               latest_story_at timestamptz, story_count integer, has_unseen boolean, cover_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $fn$
  WITH me AS (SELECT auth.uid() AS uid),
  live AS (
    SELECT s.id, s.user_id, s.created_at,
           coalesce(s.image_url, p.thumbnail_url, p.image_url) AS cover
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
           (array_agg(l.cover ORDER BY l.created_at DESC) FILTER (WHERE l.cover IS NOT NULL))[1] AS cover_url
      FROM live l
      LEFT JOIN public.story_views sv ON sv.story_id = l.id AND sv.viewer_id = (SELECT uid FROM me)
     GROUP BY l.user_id
  )
  SELECT a.user_id, p.full_name, p.avatar_url,
         (a.user_id = public.get_primary_admin_user_id()) AS is_official,
         a.latest_story_at, a.story_count, a.has_unseen, a.cover_url
    FROM active a
    JOIN public.profiles_public_data p ON p.id = a.user_id
   ORDER BY a.latest_story_at DESC
   LIMIT 100;
$fn$;
REVOKE ALL ON FUNCTION public.get_feed_stories_bar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feed_stories_bar() TO authenticated, service_role;

-- ── 8. one member's stories, as the viewer may see them ────────────────────
CREATE FUNCTION public.get_user_stories(_user_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, created_at timestamptz, expires_at timestamptz,
               post_id uuid, caption text, media text[], thumbs text[], is_video boolean,
               like_count integer, comment_count integer, i_liked boolean, view_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $fn$
  SELECT s.id, s.user_id, s.created_at, s.expires_at, s.post_id,
         CASE WHEN s.post_id IS NULL THEN s.caption ELSE nullif(btrim(p.content), '') END,
         CASE WHEN s.post_id IS NULL THEN ARRAY[s.image_url]
              WHEN cardinality(p.image_urls) > 0 THEN p.image_urls[1:10]
              WHEN p.image_url IS NOT NULL THEN ARRAY[p.image_url]
              ELSE '{}'::text[] END,
         CASE WHEN s.post_id IS NULL THEN '{}'::text[]
              ELSE coalesce(p.thumbnail_urls[1:10], '{}'::text[]) END,
         (s.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.post_videos v WHERE v.post_id = s.post_id)),
         (SELECT count(*) FROM public.story_likes l WHERE l.story_id = s.id)::int,
         CASE WHEN s.post_id IS NULL THEN (SELECT count(*) FROM public.story_comments c WHERE c.story_id = s.id)::int
              ELSE p.comments_count END,
         EXISTS (SELECT 1 FROM public.story_likes l WHERE l.story_id = s.id AND l.user_id = auth.uid()),
         CASE WHEN s.user_id = auth.uid()
              THEN (SELECT count(*) FROM public.story_views v WHERE v.story_id = s.id)::int END
    FROM public.stories s
    LEFT JOIN public.posts p ON p.id = s.post_id
   WHERE s.user_id = _user_id
     AND s.expires_at > now()
     AND public.story_visible(s.user_id, s.post_id)
   ORDER BY s.created_at ASC
   LIMIT 100;
$fn$;
REVOKE ALL ON FUNCTION public.get_user_stories(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_stories(uuid) TO authenticated, service_role;

-- ── 9. post → story (the ticked box) ───────────────────────────────────────
CREATE FUNCTION public.story_add_post(_post_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path = ''
AS $fn$
DECLARE
  _uid   uuid := auth.uid();
  _p     record;
  _id    uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'ST-0100-002: sign in to add a story' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF public.is_banned(_uid) OR NOT public.account_is_live() THEN
    RAISE EXCEPTION 'ST-0100-003: this account cannot add a story' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.id, p.user_id, p.image_url, p.image_urls, p.thumbnail_url, p.thumbnail_urls INTO _p
    FROM public.posts p WHERE p.id = _post_id;
  IF NOT FOUND OR _p.user_id <> _uid THEN
    RAISE EXCEPTION 'ST-0100-004: only your own post can go to your story' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.stories (user_id, post_id, image_url, expires_at)
  VALUES (_uid, _post_id,
          coalesce(_p.thumbnail_urls[1], _p.image_urls[1], _p.thumbnail_url, _p.image_url),
          now() + interval '24 hours')
  ON CONFLICT (post_id) WHERE post_id IS NOT NULL DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NULL THEN
    SELECT s.id INTO _id FROM public.stories s WHERE s.post_id = _post_id;
  END IF;
  RETURN _id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.story_add_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.story_add_post(uuid) TO authenticated, service_role;

-- ── 10. the comments shown on a story ──────────────────────────────────────
-- A post story shows the post's comments; a plain story its own. A story in
-- a highlight stays readable after it expires (that is what keeps comments).
CREATE FUNCTION public.story_comments_list(_story_id uuid, _limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, user_id uuid, full_name text, avatar_url text, content text, created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $fn$
  WITH s AS (
    SELECT st.id, st.post_id
      FROM public.stories st
     WHERE st.id = _story_id
       AND public.story_visible(st.user_id, st.post_id)
       AND (st.expires_at > now()
            OR EXISTS (SELECT 1 FROM public.highlight_items hi WHERE hi.story_id = st.id))
  ),
  c AS (
    SELECT pc.id, pc.user_id, pc.content, pc.created_at
      FROM s JOIN public.post_comments pc ON pc.post_id = s.post_id
     WHERE s.post_id IS NOT NULL
    UNION ALL
    SELECT sc.id, sc.user_id, sc.content, sc.created_at
      FROM s JOIN public.story_comments sc ON sc.story_id = s.id
     WHERE s.post_id IS NULL
  ),
  newest AS (
    SELECT * FROM c ORDER BY c.created_at DESC
     LIMIT least(greatest(coalesce(_limit, 50), 1), 100)
  )
  SELECT n.id, n.user_id, pp.full_name, pp.avatar_url, n.content, n.created_at
    FROM newest n
    LEFT JOIN public.profiles_public_data pp ON pp.id = n.user_id
   ORDER BY n.created_at ASC;
$fn$;
REVOKE ALL ON FUNCTION public.story_comments_list(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.story_comments_list(uuid, integer) TO authenticated, service_role;

-- ── 11. nightly clean-up ───────────────────────────────────────────────────
CREATE FUNCTION public.story_cleanup()
 RETURNS integer
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path = ''
AS $fn$
DECLARE
  _n integer;
BEGIN
  DELETE FROM public.stories s
   WHERE s.expires_at < now() - interval '1 day'
     AND NOT EXISTS (SELECT 1 FROM public.highlight_items hi WHERE hi.story_id = s.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.story_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.story_cleanup() TO service_role;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('stories-cleanup', '40 3 * * *', 'SELECT public.story_cleanup();');
  ELSE
    RAISE NOTICE 'ST-0100: no pg_cron on this lane — stories-cleanup not scheduled';
  END IF;
END
$cron$;

-- ── POST ───────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['public.story_visible(uuid,uuid)', 'public.get_feed_stories_bar()',
    'public.get_user_stories(uuid)', 'public.story_add_post(uuid)', 'public.story_comments_list(uuid,integer)',
    'public.story_cleanup()', 'public.story_comment_notify()', 'public.story_comments_rate_limit()',
    'public.highlight_items_own_story()'] LOOP
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = _f::regprocedure) THEN
      RAISE EXCEPTION 'ST-0100-POST-001: % is not SECURITY DEFINER', _f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.get_user_stories(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.story_add_post(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.story_cleanup()', 'EXECUTE')
     OR has_table_privilege('anon', 'public.story_comments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.story_comments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.story_likes', 'SELECT') THEN
    RAISE EXCEPTION 'ST-0100-POST-002: a grant is wider than intended';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_feed_stories_bar()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ST-0100-POST-003: authenticated lost get_feed_stories_bar';
  END IF;
  RAISE NOTICE 'ST-0100 applied on %: stories v2 (post stories, likes, comments, highlight keep, clean-up)',
    current_setting('p32.lane', true);
END
$post$;

COMMIT;
