-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0160 push receipts + failure alarm. Unschedules the cron
-- job, closes the alarm it may have opened, drops the four functions and the
-- receipts table. Refuses if not applied. send-push keeps working: a missing
-- start() is treated as "no receipt" (the message is today's message).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'NC-0160-RB-PRE-001: 20261104_0160 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notification-delivery-alarm';
SELECT public.ops_alarm_set('notif_push_failing', false, 'push receipts removed', NULL);
DROP FUNCTION IF EXISTS public.notification_delivery_alarm_tick();
DROP FUNCTION IF EXISTS public.notification_delivery_opened(bigint);
DROP FUNCTION IF EXISTS public.notification_delivery_finish(bigint, integer, integer, integer, text);
DROP FUNCTION IF EXISTS public.notification_delivery_start(uuid, text, text, uuid);
DROP TABLE IF EXISTS public.notification_deliveries;

COMMIT;
