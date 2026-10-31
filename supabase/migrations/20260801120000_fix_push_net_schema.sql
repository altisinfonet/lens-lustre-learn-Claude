-- ============================================================================
-- FIX: push notifications never fired. Wrong schema on pg_net.  (2026-08-01)
--
-- WHAT WAS WRONG
--   push_on_notification() called `extensions.net.http_post(...)`. On this
--   database pg_net installs http_post into schema `net`, NOT `extensions.net`
--   (verified: select n.nspname from pg_proc p join pg_namespace n
--    on n.oid = p.pronamespace where p.proname = 'http_post';  ->  net).
--
--   The bad path raised an error on EVERY notification, and the function's own
--   `EXCEPTION WHEN OTHERS THEN RETURN NEW` swallowed it. So push had never
--   worked since launch, and left no trace anywhere: 9 devices registered,
--   308 notifications in 24h, zero pushes delivered, zero errors visible.
--
-- WHAT THIS CHANGES
--   1. `net.http_post(...)`  (was `extensions.net.http_post`)
--   2. the catch-all now RAISE LOG s the SQLSTATE and message before returning,
--      so the next failure is findable in the Postgres logs instead of silent.
--      It still never re-raises: a push problem must never break the insert.
--
-- This was applied by hand in the SQL editor on 2026-08-01. This migration
-- records it so a rebuild does not silently reintroduce the bug.
-- Idempotent: CREATE OR REPLACE only. No table, trigger or row is touched.
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
    RETURN NEW;  -- not configured yet: notification still saved, no push
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

  -- Fire-and-forget. pg_net queues the request; failures never reach this
  -- transaction, so the notification insert is always safe.
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
  -- A push problem must never break notifications. But it must not be silent
  -- either -- that is precisely how this bug survived undetected.
  RAISE LOG 'push_on_notification failed for user % : % / %', NEW.user_id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$fn$;
