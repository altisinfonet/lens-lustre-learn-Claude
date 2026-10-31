-- ============================================================================
-- PUSH DELIVERY OBSERVABILITY  (owner request 2026-08-01)
--
-- THE PROBLEM THIS SOLVES
--   Push notifications were broken from launch until 2026-08-01 and NOBODY
--   KNEW. Not the owner, not the members, not any log. 9 devices registered,
--   308 notifications in 24 hours, zero delivered, zero errors anywhere,
--   because push_on_notification() swallowed every failure and returned
--   normally. The bug was only found by reading the function by hand.
--
--   Fixing that bug did not fix the class of bug. A system you cannot observe
--   will fail silently again — a rotated FCM key, a revoked secret, a Supabase
--   change, a bad token batch. This makes delivery VISIBLE, so the next failure
--   is noticed in hours instead of months.
--
-- WHAT THIS ADDS  (additive only — nothing is dropped or altered)
--   1. push_delivery_log — one row per notification, recording what the push
--      trigger DECIDED and why. Not a debug aid bolted on later: it is written
--      on every path, including the ones that deliberately do nothing.
--   2. push_on_notification() instrumented to write that row on every path.
--      The logging itself is wrapped so it can never break a notification.
--   3. get_push_health() — an admin-only summary, including the single most
--      important number: notifications created vs pushes actually queued in the
--      last 24 hours. If the first is large and the second is zero, delivery is
--      dead. That comparison is exactly what nobody could see before.
--
-- OUTCOMES RECORDED
--   queued                  handed to pg_net for delivery
--   skipped_self            the actor is the recipient; correct, not a fault
--   skipped_preference      the user turned this type off; correct, not a fault
--   skipped_unconfigured    push_config.function_url is NULL
--   error                   the trigger raised; detail carries SQLSTATE/SQLERRM
--
--   "queued" means handed to pg_net, NOT confirmed on a handset. Nothing in the
--   database can know that. Do not read this table as proof of receipt — it is
--   proof of ATTEMPT, which is the thing that was previously invisible.
--
-- RETENTION
--   ~308 rows/day today. Left unpruned on purpose: this is the audit trail for
--   a subsystem with a history of silent failure, and a month of it is a few
--   thousand rows. If it ever needs trimming, delete by created_at — unlike
--   feed_events, which must never be pruned by age (DEPLOY_CACHE_GOTCHA §4).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_delivery_log (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL,
  notification_id uuid,
  type            text NOT NULL,
  outcome         text NOT NULL,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_delivery_log_outcome_chk CHECK (outcome IN (
    'queued','skipped_self','skipped_preference','skipped_unconfigured','error'
  ))
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_log_created ON public.push_delivery_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_delivery_log_outcome ON public.push_delivery_log (outcome, created_at DESC);

ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;

-- No policy for members. The trigger writes as SECURITY DEFINER and the health
-- RPC reads as SECURITY DEFINER, so nothing needs direct member access. An
-- RLS-enabled table with no permissive policy denies everyone by default —
-- that is deliberate, not an omission.

COMMENT ON TABLE public.push_delivery_log IS
  'One row per notification recording what push_on_notification() decided. '
  '"queued" = handed to pg_net, NOT proof of receipt on a handset. Read through '
  'get_push_health(). Created 2026-08-01 after push failed silently from launch.';

-- Writing the log must never be able to break a notification insert. If the log
-- table is missing, full, or locked, we lose observability -- not the product.
CREATE OR REPLACE FUNCTION public.log_push_outcome(
  _user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.push_delivery_log (user_id, notification_id, type, outcome, detail)
  VALUES (_user_id, _notification_id, _type, _outcome, left(_detail, 500));
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'log_push_outcome failed (observability only, notification unaffected): % / %',
            SQLSTATE, SQLERRM;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Instrumented trigger. Same behaviour as 20260801180000, plus a log row on
-- every path. Behavioural changes: none.
-- ---------------------------------------------------------------------------
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
    PERFORM public.log_push_outcome(NEW.user_id, NEW.id, NEW.type, 'skipped_unconfigured', NULL);
    RETURN NEW;
  END IF;

  IF NEW.actor_id IS NOT NULL AND NEW.actor_id = NEW.user_id THEN
    PERFORM public.log_push_outcome(NEW.user_id, NEW.id, NEW.type, 'skipped_self', NULL);
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
    PERFORM public.log_push_outcome(NEW.user_id, NEW.id, NEW.type, 'skipped_preference', NULL);
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

  PERFORM public.log_push_outcome(NEW.user_id, NEW.id, NEW.type, 'queued', NULL);
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'push_on_notification failed for user % : % / %', NEW.user_id, SQLSTATE, SQLERRM;
  PERFORM public.log_push_outcome(NEW.user_id, NEW.id, NEW.type, 'error',
                                  SQLSTATE || ' / ' || SQLERRM);
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Admin health summary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_push_health()
RETURNS TABLE (
  devices_registered        int,
  members_with_a_device     int,
  notifications_24h         int,
  queued_24h                int,
  skipped_preference_24h    int,
  skipped_self_24h          int,
  errors_24h                int,
  last_queued_at            timestamptz,
  last_error_at             timestamptz,
  last_error_detail         text,
  delivery_looks_dead       boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    (SELECT count(*)::int FROM public.push_tokens),
    (SELECT count(DISTINCT user_id)::int FROM public.push_tokens),
    (SELECT count(*)::int FROM public.user_notifications
      WHERE created_at > now() - interval '24 hours'),
    (SELECT count(*)::int FROM public.push_delivery_log
      WHERE outcome = 'queued' AND created_at > now() - interval '24 hours'),
    (SELECT count(*)::int FROM public.push_delivery_log
      WHERE outcome = 'skipped_preference' AND created_at > now() - interval '24 hours'),
    (SELECT count(*)::int FROM public.push_delivery_log
      WHERE outcome = 'skipped_self' AND created_at > now() - interval '24 hours'),
    (SELECT count(*)::int FROM public.push_delivery_log
      WHERE outcome = 'error' AND created_at > now() - interval '24 hours'),
    (SELECT max(created_at) FROM public.push_delivery_log WHERE outcome = 'queued'),
    (SELECT max(created_at) FROM public.push_delivery_log WHERE outcome = 'error'),
    (SELECT detail FROM public.push_delivery_log
      WHERE outcome = 'error' ORDER BY created_at DESC LIMIT 1),
    -- THE alarm. Notifications are being created, devices exist, and yet not one
    -- push has been queued in 24h. That is the exact state the platform sat in,
    -- undetected, from launch until 2026-08-01.
    (SELECT (SELECT count(*) FROM public.user_notifications
              WHERE created_at > now() - interval '24 hours') > 0
        AND (SELECT count(*) FROM public.push_tokens) > 0
        AND (SELECT count(*) FROM public.push_delivery_log
              WHERE outcome = 'queued' AND created_at > now() - interval '24 hours') = 0)
  WHERE public.app_has_role(auth.uid(), 'admin');   -- admins only; others get zero rows
$$;

GRANT EXECUTE ON FUNCTION public.get_push_health() TO authenticated;

COMMENT ON FUNCTION public.get_push_health() IS
  'Admin-only push delivery health. delivery_looks_dead = notifications are being '
  'created and devices are registered but nothing has been queued in 24h — the '
  'exact undetected state that persisted from launch until 2026-08-01.';
