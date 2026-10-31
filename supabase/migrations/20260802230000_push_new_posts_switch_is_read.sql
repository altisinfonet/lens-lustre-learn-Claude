-- ============================================================================
-- THE NEW-POST PUSH GETS ITS OWN OFF SWITCH.                 (Stage 7b, 2026-08-02)
--
-- WHAT WAS WRONG — and this one I opened myself
--   `notification_preferences.push_new_posts` has existed since push was added.
--   `push_on_notification()` never read it: `new_post_from_following` fell
--   through the preference CASE to `ELSE true`, i.e. "push to everyone".
--
--   That type is the HIGHEST-VOLUME push on the platform. So the one alert a
--   member is most likely to want quietened was the one thing they could only
--   silence by turning every push off.
--
--   When the push settings screen shipped an hour ago (PR #46) I deliberately
--   left this toggle OFF the screen, because a switch the server ignores is
--   worse than no switch. This is the other half: the server reads it, so the
--   switch can exist.
--
-- WHAT THIS CHANGES
--   ONE line in the preference CASE. Everything else in the function is
--   reproduced byte-for-byte from 20260802090000 so this file remains the whole
--   truth about what the trigger does:
--
--     + WHEN NEW.type = 'new_post_from_following' THEN np.push_new_posts
--
--   Order inside the CASE matters and is unchanged: `push_enabled = false` is
--   still evaluated FIRST, so the master switch still silences everything
--   including this. The new branch only narrows, never widens.
--
--   Default is true (the column is NOT NULL DEFAULT true) and no row is
--   updated, so nobody's pushes change until they choose to change them.
--
-- ROLLBACK: re-run 20260802090000_push_text_from_catalog.sql.
-- ============================================================================

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
    RETURN NEW;
  END IF;

  -- Never push to the person who caused the event.
  IF NEW.actor_id IS NOT NULL AND NEW.actor_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Per-user preferences. Missing row = all defaults on.
  SELECT CASE
           WHEN np.user_id IS NULL THEN true
           WHEN np.push_enabled = false THEN false
           WHEN NEW.type IN ('post_reaction','image_reaction')            THEN np.push_reactions
           WHEN NEW.type IN ('post_comment','image_comment','comment_reply') THEN np.push_comments
           WHEN NEW.type = 'friend_request'                                THEN np.push_friend_requests
           WHEN NEW.type = 'new_follower'                                  THEN np.push_new_followers
           -- ▼ THE ONE ADDED LINE. This type used to fall through to ELSE true.
           WHEN NEW.type = 'new_post_from_following'                       THEN np.push_new_posts
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
                 'body',    public.notif_push_body(NEW.type, NEW.actor_id, NEW.message),
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
