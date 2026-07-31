-- ============================================================================
-- PUSH NOTIFICATIONS: fire send-push whenever a user_notification is created.
--
-- Until now NOTHING called the send-push edge function — verified by searching
-- every migration and every function. This adds the missing link.
--
-- Design notes:
--   * pg_net (already enabled and used by the email queue) posts asynchronously,
--     so a slow or failing push can NEVER block or roll back the notification
--     insert itself.
--   * Auth uses the x-internal-secret header that send-push already supports,
--     so no service-role key is stored in the database.
--   * Adds push_* columns to notification_preferences (default ON) so users can
--     switch pushes off — the table previously had only email_* and in-app
--     toggles, and shipping pushes with no off switch is a store-compliance risk.
--
-- ROLLBACK (one line, everything else becomes inert):
--   DROP TRIGGER trg_push_on_notification ON public.user_notifications;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 1) Per-user push toggles. Default true so existing rows keep working.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_enabled              boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_reactions            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_comments             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_friend_requests      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_new_followers        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_competition_updates  boolean NOT NULL DEFAULT true;

-- 2) Where to POST and with what secret. Stored in a private settings table
--    rather than hardcoded, so the secret can be rotated without a migration.
CREATE TABLE IF NOT EXISTS public.push_config (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  function_url  text NOT NULL,
  internal_secret text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;

-- No policy for normal users: only service_role / SECURITY DEFINER can read it.
DROP POLICY IF EXISTS "service role manages push config" ON public.push_config;
CREATE POLICY "service role manages push config" ON public.push_config
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 3) The trigger function.
CREATE OR REPLACE FUNCTION public.push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cfg   public.push_config%ROWTYPE;
  _allow boolean := true;
BEGIN
  SELECT * INTO _cfg FROM public.push_config WHERE id LIMIT 1;
  IF _cfg.function_url IS NULL THEN
    RETURN NEW;  -- not configured yet: do nothing, notification still saved
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
  PERFORM extensions.net.http_post(
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
  -- A push problem must never break notifications.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_notification ON public.user_notifications;
CREATE TRIGGER trg_push_on_notification
AFTER INSERT ON public.user_notifications
FOR EACH ROW EXECUTE FUNCTION public.push_on_notification();
