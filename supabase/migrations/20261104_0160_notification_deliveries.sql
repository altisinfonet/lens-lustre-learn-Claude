-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0160 · NOTIFICATION CENTRE N4 — push receipts and the failure alarm.
--
-- Today send-push counts successes in memory and forgets them: nothing records
-- whether a push reached a phone, failed, or was opened, and nothing pages
-- anyone when pushes stop working (N0 gap G8).
--
-- WHAT IT ADDS
--   table    public.notification_deliveries — one row per push send:
--            sending → sent | failed | no_device, device counts, a short error,
--            opened_at when the member taps it. Kept 30 days.
--   function notification_delivery_start(user, type, channel, notification)
--            service_role (send-push). Returns a delivery id — or NULL, and
--            records nothing, unless the type's group is switched on for that
--            member (notification_centre_live). So receipts roll out with each
--            group and nothing changes on live while every switch is off.
--   function notification_delivery_finish(id, ok, failed, pruned, error)
--            service_role (send-push). Sets the outcome once.
--   function notification_delivery_opened(id)   members, own push rows only.
--   function notification_delivery_alarm_tick() service_role / cron: in the
--            last hour, >= 20 finished pushes and >= 50 % failed (a row stuck
--            in 'sending' for 10 min counts as failed) → ops alarm
--            notif_push_failing; otherwise the alarm closes. Purges > 30 days.
--   cron     notification-delivery-alarm, every 15 minutes.
--
-- Rollback: supabase/rollback/20261104_0160_notification_deliveries_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0160_notification_deliveries.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.notification_deliveries') IS NOT NULL THEN
    RAISE EXCEPTION 'NC-0160-PRE-001: already applied — roll back first';
  END IF;
  IF to_regprocedure('public.notification_centre_live(text, uuid)') IS NULL
     OR to_regclass('public.notification_types') IS NULL THEN
    RAISE EXCEPTION 'NC-0160-PRE-002: 20261104_0110 (the centre) is not applied on this lane';
  END IF;
  IF to_regprocedure('public.ops_alarm_set(text, boolean, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'NC-0160-PRE-003: public.ops_alarm_set missing (20261103_0300 not applied)';
  END IF;
  IF to_regprocedure('cron.schedule(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'NC-0160-PRE-004: pg_cron (cron.schedule) not installed';
  END IF;
END
$pre$;

CREATE TABLE public.notification_deliveries (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid        NOT NULL,
  type            text        NOT NULL,
  channel         text        NOT NULL CHECK (channel IN ('push', 'email')),
  notification_id uuid,
  status          text        NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'no_device')),
  devices_ok      integer     NOT NULL DEFAULT 0 CHECK (devices_ok >= 0),
  devices_failed  integer     NOT NULL DEFAULT 0 CHECK (devices_failed >= 0),
  devices_pruned  integer     NOT NULL DEFAULT 0 CHECK (devices_pruned >= 0),
  error           text        CHECK (length(error) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  opened_at       timestamptz
);
-- P28: notification_deliveries · 0 rows at launch (written only for a group switched on); ~50/day per live group · the alarm tick and the 30-day purge scan by created_at
CREATE INDEX notification_deliveries_created_at_idx ON public.notification_deliveries (created_at);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_deliveries TO service_role;

CREATE FUNCTION public.notification_delivery_start(_user uuid, _type text, _channel text, _notification uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  grp text;
  new_id bigint;
BEGIN
  IF _user IS NULL OR _channel IS NULL OR _channel NOT IN ('push', 'email') THEN
    RETURN NULL;
  END IF;
  SELECT nt.group_key INTO grp FROM public.notification_types nt WHERE nt.type = _type;
  IF grp IS NULL OR NOT public.notification_centre_live(grp, _user) THEN
    RETURN NULL;                                   -- group off for this member: no receipt, today's behaviour
  END IF;
  INSERT INTO public.notification_deliveries (user_id, type, channel, notification_id)
  VALUES (_user, _type, _channel, _notification)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$fn$;

CREATE FUNCTION public.notification_delivery_finish(_id bigint, _ok integer, _failed integer, _pruned integer DEFAULT 0, _error text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE st text;
BEGIN
  UPDATE public.notification_deliveries d
     SET status = CASE WHEN greatest(coalesce(_ok, 0), 0) > 0 THEN 'sent'
                       WHEN greatest(coalesce(_failed, 0), 0) > 0 THEN 'failed'
                       ELSE 'no_device' END,
         devices_ok     = greatest(coalesce(_ok, 0), 0),
         devices_failed = greatest(coalesce(_failed, 0), 0),
         devices_pruned = greatest(coalesce(_pruned, 0), 0),
         error          = left(_error, 300),
         finished_at    = now()
   WHERE d.id = _id AND d.status = 'sending'       -- an outcome is set once
  RETURNING d.status INTO st;
  RETURN st;
END;
$fn$;

CREATE FUNCTION public.notification_delivery_opened(_id bigint)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE hit boolean;
BEGIN
  UPDATE public.notification_deliveries d
     SET opened_at = now()
   WHERE d.id = _id AND d.user_id = auth.uid() AND d.channel = 'push' AND d.opened_at IS NULL
  RETURNING true INTO hit;
  RETURN coalesce(hit, false);
END;
$fn$;

CREATE FUNCTION public.notification_delivery_alarm_tick()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  total integer;
  bad   integer;
BEGIN
  SELECT count(*) FILTER (WHERE d.status IN ('sent', 'failed') OR (d.status = 'sending' AND d.created_at < now() - interval '10 minutes')),
         count(*) FILTER (WHERE d.status = 'failed' OR (d.status = 'sending' AND d.created_at < now() - interval '10 minutes'))
    INTO total, bad
    FROM public.notification_deliveries d
   WHERE d.channel = 'push' AND d.created_at > now() - interval '1 hour';

  PERFORM public.ops_alarm_set(
    'notif_push_failing',
    total >= 20 AND bad * 2 >= total,
    format('%s of %s pushes in the last hour failed', bad, total),
    jsonb_build_object('failed', bad, 'finished', total, 'checked_at', now()));

  DELETE FROM public.notification_deliveries d WHERE d.created_at < now() - interval '30 days';
  RETURN bad;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notification_delivery_start(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_delivery_finish(bigint, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_delivery_opened(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_delivery_alarm_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_delivery_start(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_delivery_finish(bigint, integer, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_delivery_opened(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notification_delivery_alarm_tick() TO service_role;

SELECT cron.schedule('notification-delivery-alarm', '*/15 * * * *',
                     $cron$SELECT public.notification_delivery_alarm_tick();$cron$);

COMMIT;
