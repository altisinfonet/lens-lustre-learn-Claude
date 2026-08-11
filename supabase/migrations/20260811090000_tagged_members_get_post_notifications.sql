-- ============================================================================
-- TAGGED MEMBERS GET THE POST'S LIKE AND COMMENT NOTIFICATIONS.
--
-- Owner instruction, 2026-08-11:
--   "Build like All tagged person will get all notification untill bering
--    removed the tag."
--
-- And, on being asked whether the tag must be APPROVED first:
--   "Here is Approval of Tag is not required, I asked if tagged automcatically
--    tagging will happedned just anyone can remove himself from tag On post
--    'Remove me from tag', so why approval of tag is coming ??"
--
-- He is right, and the app already works that way. His ruling of 2026-08-10 —
-- "Show immediately to public, but tagged person only can remove my Tag
-- anytime" — is what src/components/post/TaggedPeople.tsx and the "Remove tag
-- of me" item in PostCard implement. A tag is live the moment it is made;
-- The status "pending" is only an internal label for "not yet responded to",
-- not a gate.
-- Removing yourself writes status = 'removed'.
--
-- So a tag counts as LIVE while status IN ('pending','approved'), and stops
-- counting the moment it becomes 'removed' or 'declined'. Nothing here changes
-- the tagging rules themselves.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE DOES, AND ONLY THIS
--
--   1. notif_action_phrase()               + 2 phrases (catalog parity)
--   2. notif_group_key()                   + 2 grouping types (volume control)
--   3. get_notification_email_enabled()    + 2 types pinned to NO EMAIL
--   4. pj_handle_reaction_notification()   + a fan-out to live tagged members
--   5. pj_handle_comment_notification()    + a fan-out to live tagged members
--
-- Every existing recipient keeps exactly the recipient behaviour they had.
-- The two handlers below are the live versions read out of pg_proc on
-- 2026-08-11 (the repo's copy of these triggers is stale — the sync triggers in
-- 20260323093425 were replaced by this job-queue design and never written
-- back), reproduced UNCHANGED except for the blocks marked "ADDED 2026-08-11".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO EMAIL FOR THE TAGGED FAN-OUT — owner's choice, 2026-08-11
--
-- He picked "In-app + push only, no email". The reason is volume: a post with
-- 19 tags that collects 16 likes and 8 comments would otherwise send up to 480
-- emails from one post. The post OWNER's emails are untouched.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE RECIPIENT IS NEVER DOUBLE-NOTIFIED
--
-- The fan-out skips three people who are already covered by an existing row:
--   * the actor        — you are not told about your own like
--   * the post owner   — already gets post_reaction / post_comment
--   * the parent-comment author on a reply — already gets comment_reply
--
-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSAL
--
-- Re-run this file with the two blocks marked "ADDED 2026-08-11" deleted, and
-- drop the two new WHEN lines from notif_action_phrase, notif_group_key and
-- get_notification_email_enabled. Nothing else in the database is touched, and
-- rows already written stay readable because describe.ts falls back to the
-- stored message for any type it does not phrase.
--
-- Migrations do NOT auto-apply on this project. This file is the record; the
-- statements were run by hand in the Supabase SQL editor.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The phrase catalog.
--
-- BYTE-IDENTICAL to ACTION_CATALOG in src/lib/notifications/describe.ts, and to
-- the same function in 20260802090000_push_text_from_catalog.sql.
-- pushCatalogParity.test.ts compares all three and fails if one character
-- differs. Note "you are tagged in", not "you're": the parity test extracts
-- phrases with a regex that cannot see past an escaped apostrophe, and an
-- apostrophe inside a SQL string literal would have to be doubled.
-- ─────────────────────────────────────────────────────────────────────────────
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
           ELSE NULL
         END;
$fn$;

COMMENT ON FUNCTION public.notif_action_phrase(text) IS
  'Singular action phrase for a notification type. Byte-identical copy of ACTION_CATALOG in src/lib/notifications/describe.ts, enforced by pushCatalogParity.test.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Grouping. The two new types join the "noisy" list so 16 likes on a photo
--    you are tagged in collapse into ONE bell line for that day, exactly as 16
--    likes on your own photo already do. Without this, a tagged member on a
--    busy post would scroll past 16 identical rows.
--
--    Reproduced whole; the only change is the two names on the WHEN list.
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
                          'image_comment','comment_reply','new_post_from_following',
                          'tagged_post_reaction','tagged_post_comment')
             THEN _type || '|' || to_char(date_trunc('day', _created_at), 'YYYY-MM-DD')
           ELSE _type || '|' || _id::text          -- never grouped: unique key
         END;
$fn$;

COMMENT ON FUNCTION public.notif_group_key(text, timestamptz, uuid) IS
  'The one definition of what counts as a single notification group. Called by get_my_notifications_grouped and get_my_unread_notifications_grouped so the history page and the bell can never disagree.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Email policy. Reproduced whole from the live function; the ONLY change is
--    the one WHEN line marked below. Every other type keeps the exact branch it
--    had, including the two default-false broadcast rules.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_notification_email_enabled(_user_id uuid, _notif_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN _notif_type IN ('ticket_reply', 'role_approved', 'role_rejected', 'friend_accepted') THEN true
    -- ADDED 2026-08-11: the tagged fan-out is in-app and push only (owner's
    -- choice). Placed ABOVE the reaction/comment branches so it cannot be
    -- swallowed by them, and above ELSE true so it cannot fall through to mail.
    WHEN _notif_type IN ('tagged_post_reaction', 'tagged_post_comment') THEN false
    WHEN _notif_type IN ('post_reaction', 'image_reaction', 'competition_vote') THEN
      COALESCE((SELECT email_reactions FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('post_comment', 'comment_reply', 'image_comment') THEN
      COALESCE((SELECT email_comments FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('friend_request') THEN
      COALESCE((SELECT email_friend_requests FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('new_follower') THEN
      COALESCE((SELECT email_new_followers FROM notification_preferences WHERE user_id = _user_id), true)
    -- BUG-039: ALL competition-result types respect the Competition Updates toggle
    WHEN _notif_type IN ('entry_approved', 'entry_rejected', 'competition_winner',
                         'entry_qualified', 'entry_finalist', 'entry_shortlisted',
                         'round_results_published', 'potd_featured') THEN
      COALESCE((SELECT email_competition_updates FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('certificate_issued') THEN
      COALESCE((SELECT email_certificates FROM notification_preferences WHERE user_id = _user_id), true)
    WHEN _notif_type IN ('badge_awarded') THEN
      COALESCE((SELECT email_gift_credits FROM notification_preferences WHERE user_id = _user_id), true)
    -- BUG-039: course publishing is an opt-in broadcast (default OFF preserves BUG-038)
    WHEN _notif_type IN ('course_published') THEN
      COALESCE((SELECT email_course_updates FROM notification_preferences WHERE user_id = _user_id), false)
    -- BUG-038: mass-broadcast types never email the whole base
    WHEN _notif_type IN ('new_competition', 'journal_published') THEN false
    ELSE true
  END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Reactions.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pj_handle_reaction_notification(_msg jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _reaction_id uuid := (_msg->>'reaction_id')::uuid;
  _post_id     uuid := (_msg->>'post_id')::uuid;
  _actor_id    uuid := (_msg->>'actor_id')::uuid;
  _post_owner  uuid;
  _actor_name  text;
  _tagged      record;   -- ADDED 2026-08-11
BEGIN
  -- Skip if the user un-reacted before we ran (old sync path would already
  -- have notified; skipping is the more correct behaviour).
  IF NOT EXISTS (SELECT 1 FROM public.post_reactions WHERE id = _reaction_id) THEN
    RETURN;
  END IF;

  SELECT user_id INTO _post_owner FROM public.posts WHERE id = _post_id;
  -- Post deleted. Nothing to notify anybody about, owner or tagged.
  IF _post_owner IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(full_name, 'Someone') INTO _actor_name
  FROM public.profiles WHERE id = _actor_id;

  -- Same title/message as the original sync trigger (migration 20260323093425).
  --
  -- CHANGED 2026-08-11: this used to be an early RETURN when the actor was the
  -- owner. It is now a guard around the owner's row only, so that an owner
  -- liking their own photo still reaches the people tagged in it. No existing
  -- recipient gains or loses a row: the owner is skipped in exactly the same
  -- case as before.
  IF _post_owner <> _actor_id THEN
    INSERT INTO public.user_notifications
      (user_id, actor_id, type, title, message, reference_id, dedup_key)
    VALUES (
      _post_owner,
      _actor_id,
      'post_reaction',
      'New Reaction',
      COALESCE(_actor_name, 'Someone') || ' reacted to your post',
      _post_id,
      'post_reaction:' || _reaction_id::text
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END IF;

  -- ── ADDED 2026-08-11: everyone tagged in this photo, while the tag is live ──
  -- 'removed' (self-removal from the post menu) and 'declined' both drop out of
  -- this list immediately, which is the whole of "untill bering removed the tag".
  FOR _tagged IN
    SELECT t.tagged_user_id
    FROM public.post_tags t
    WHERE t.post_id = _post_id
      AND t.status IN ('pending', 'approved')
      AND t.tagged_user_id <> _actor_id     -- not your own like
      AND t.tagged_user_id <> _post_owner   -- the owner already has a row above
  LOOP
    INSERT INTO public.user_notifications
      (user_id, actor_id, type, title, message, reference_id, dedup_key)
    VALUES (
      _tagged.tagged_user_id,
      _actor_id,
      'tagged_post_reaction',
      'New Reaction',
      COALESCE(_actor_name, 'Someone') || ' reacted to a photo you are tagged in',
      _post_id,
      'tagged_post_reaction:' || _reaction_id::text || ':' || _tagged.tagged_user_id::text
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Comments and replies.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pj_handle_comment_notification(_msg jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _comment_id    uuid := (_msg->>'comment_id')::uuid;
  _post_id       uuid := (_msg->>'post_id')::uuid;
  _actor_id      uuid := (_msg->>'actor_id')::uuid;
  _parent_id     uuid;   -- read from the live row, not the payload
  _post_owner    uuid;
  _parent_author uuid;
  _actor_name    text;
  _tagged        record; -- ADDED 2026-08-11
BEGIN
  -- Skip if the comment was deleted before we ran.
  SELECT parent_id INTO _parent_id
  FROM public.post_comments WHERE id = _comment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT user_id INTO _post_owner FROM public.posts WHERE id = _post_id;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name
  FROM public.profiles WHERE id = _actor_id;

  -- 1) Notify post owner (same guard as original trigger).
  IF _post_owner IS NOT NULL AND _post_owner <> _actor_id THEN
    INSERT INTO public.user_notifications
      (user_id, actor_id, type, title, message, reference_id, dedup_key)
    VALUES (
      _post_owner,
      _actor_id,
      'post_comment',
      'New Comment',
      COALESCE(_actor_name, 'Someone') || ' commented on your post',
      _post_id,
      'post_comment:' || _comment_id::text || ':owner'
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END IF;

  -- 2) Notify parent-comment author on replies (same guards as original).
  IF _parent_id IS NOT NULL THEN
    SELECT user_id INTO _parent_author
    FROM public.post_comments WHERE id = _parent_id;
    IF _parent_author IS NOT NULL
       AND _parent_author <> _actor_id
       AND (_post_owner IS NULL OR _parent_author <> _post_owner) THEN
      INSERT INTO public.user_notifications
        (user_id, actor_id, type, title, message, reference_id, dedup_key)
      VALUES (
        _parent_author,
        _actor_id,
        'comment_reply',
        'New Reply',
        COALESCE(_actor_name, 'Someone') || ' replied to your comment',
        _post_id,
        'post_comment:' || _comment_id::text || ':reply'
      )
      ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  -- ── ADDED 2026-08-11: 3) everyone tagged in this photo, while the tag is live.
  -- The parent-comment author is excluded because step 2 has already told them
  -- about this very comment, in more specific words.
  FOR _tagged IN
    SELECT t.tagged_user_id
    FROM public.post_tags t
    WHERE t.post_id = _post_id
      AND t.status IN ('pending', 'approved')
      AND t.tagged_user_id <> _actor_id
      AND (_post_owner IS NULL OR t.tagged_user_id <> _post_owner)
      AND (_parent_author IS NULL OR t.tagged_user_id <> _parent_author)
  LOOP
    INSERT INTO public.user_notifications
      (user_id, actor_id, type, title, message, reference_id, dedup_key)
    VALUES (
      _tagged.tagged_user_id,
      _actor_id,
      'tagged_post_comment',
      'New Comment',
      COALESCE(_actor_name, 'Someone') || ' commented on a photo you are tagged in',
      _post_id,
      'tagged_post_comment:' || _comment_id::text || ':' || _tagged.tagged_user_id::text
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$fn$;

COMMIT;
