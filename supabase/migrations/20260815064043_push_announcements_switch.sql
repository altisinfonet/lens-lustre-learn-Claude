-- ============================================================================
-- ANNOUNCEMENTS GET THEIR OWN PUSH SWITCH.
--
-- WHY THIS EXISTS
-- `get_notification_email_enabled` deliberately bars two types from mail:
--   journal_published  -> hard false
--   course_published   -> defaults false (opt-in)
-- The comment above them in that function states the rule: BUG-038, "mass
-- broadcast types never email the whole base."
--
-- `push_on_notification` has its own, shorter list and neither type is on it,
-- so both fell through to `ELSE true` and were delivered to EVERY registered
-- device. A type deliberately kept out of the member's inbox was arriving on
-- their phone, and the only defence was `push_enabled`, which is all-or-
-- nothing: to stop Journal pushes a member had to stop hearing about comments
-- and follows as well.
--
-- `new_competition` is the control that shows this was an omission and not a
-- policy: it IS named in the push list, gated on `push_competition_updates`,
-- and has always behaved correctly.
--
-- OWNER DECISION, 2026-08-15: give announcements their own switch, defaulted
-- ON. Not "stop pushing them" — the reach is wanted; what was missing was the
-- member's ability to decline it without declining everything.
--
-- WHY `new_competition` IS DELIBERATELY NOT MOVED HERE
-- It already has a switch members understand. Re-pointing it at the new column
-- would silently change behaviour for anyone who had set
-- `push_competition_updates`, which is the opposite of what this migration is
-- for.
--
-- WHY `birthday` IS DELIBERATELY NOT INCLUDED
-- `emit_birthday_notifications` also fans out daily and is also ungated in
-- push, but it is social (it reaches the birthday member's connections), not a
-- platform announcement. Folding it in here would decide a separate product
-- question inside a migration that was approved for a different one. Recorded
-- in docs/notification-recipient-integrity-matrix.md instead.
--
-- SCOPE: additive. One column, one function body. No existing row changes
-- meaning: the single existing preferences row gets the default `true`, which
-- is exactly the behaviour it has today.
-- ============================================================================

-- The column inherits `notification_preferences`' existing RLS and its six
-- policies; ADD COLUMN grants nothing new, so there is no privilege to state
-- here. (The newTableGrants gate covers CREATE TABLE, which this is not.)
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_announcements boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.push_announcements IS
  'Push for platform announcements (new Journal article, new course). Default true: the reach is wanted, the member just needs a way to decline it without switching off push entirely. Read by push_on_notification().';

-- Unchanged from the live definition except for the single WHEN branch marked
-- below. Reproduced in full because CREATE OR REPLACE has no patch form, and a
-- partial paste is how a body silently loses a branch.
CREATE OR REPLACE FUNCTION public.push_on_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cfg   public.push_config%ROWTYPE;
  _allow boolean := true;
BEGIN
  SELECT * INTO _cfg FROM public.push_config WHERE id LIMIT 1;
  IF _cfg.function_url IS NULL THEN RETURN NEW; END IF;
  IF NEW.actor_id IS NOT NULL AND NEW.actor_id = NEW.user_id THEN RETURN NEW; END IF;
  SELECT CASE
           WHEN np.user_id IS NULL THEN true
           WHEN np.push_enabled = false THEN false
           WHEN NEW.type IN ('post_reaction','image_reaction')            THEN np.push_reactions
           WHEN NEW.type IN ('post_comment','image_comment','comment_reply') THEN np.push_comments
           WHEN NEW.type = 'friend_request'                                THEN np.push_friend_requests
           WHEN NEW.type = 'new_follower'                                  THEN np.push_new_followers
           WHEN NEW.type = 'new_post_from_following'                       THEN np.push_new_posts
           WHEN NEW.type IN ('competition_vote','entry_approved','entry_rejected',
                             'competition_winner','new_competition')       THEN np.push_competition_updates
           -- ADDED 2026-08-15: the two platform broadcasts. Placed ABOVE
           -- `ELSE true` so they cannot fall through to it, and BELOW the
           -- specific branches above so it cannot swallow one of them.
           -- Neither type appears in any earlier branch (verified against the
           -- live definition before this was written), so nothing above shadows
           -- it and it shadows nothing.
           WHEN NEW.type IN ('journal_published','course_published')        THEN np.push_announcements
           ELSE true
         END
    INTO _allow
  FROM (SELECT 1) AS _one
  LEFT JOIN public.notification_preferences np ON np.user_id = NEW.user_id;
  IF _allow IS DISTINCT FROM true THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url     := _cfg.function_url,
    headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', _cfg.internal_secret),
    body    := jsonb_build_object('user_id', NEW.user_id, 'title', NEW.title,
                 'body', public.notif_push_body(NEW.type, NEW.actor_id, NEW.message),
                 'data', jsonb_build_object('type', NEW.type, 'reference_id', COALESCE(NEW.reference_id::text,'')))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'push_on_notification failed for user % : % / %', NEW.user_id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;
