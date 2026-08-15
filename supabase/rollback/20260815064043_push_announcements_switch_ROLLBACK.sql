-- ============================================================================
-- ROLLBACK for 20260815999999_push_announcements_switch.sql
--
-- Restores the exact live definition of push_on_notification() as it stood on
-- 2026-08-15 before the announcements branch was added, then drops the column.
--
-- ORDER MATTERS: the function is restored FIRST. Dropping the column while the
-- function still references it would leave every insert into
-- user_notifications raising `column np.push_announcements does not exist`,
-- which fails the trigger, which — because push_on_notification catches and
-- logs — would silently stop all push rather than fail loudly. Restore, then
-- drop.
--
-- AFTER THIS RUNS, journal_published and course_published go back to falling
-- through to `ELSE true`, i.e. pushed to every registered device with no
-- member opt-out. That is the behaviour this migration was written to end, so
-- running this rollback deliberately reinstates it. It is here because a
-- rollback that does not restore the prior state is not a rollback.
-- ============================================================================

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

ALTER TABLE public.notification_preferences
  DROP COLUMN IF EXISTS push_announcements;
