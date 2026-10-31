-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0140 notification centre gate. Drops the two BEFORE
-- INSERT triggers and the gate function; every row then goes straight in,
-- exactly as before 0140. Safe at any time (with a group live it simply
-- returns that group to today's behaviour). Refuses when 0140 is not applied.
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
  IF to_regprocedure('public.notification_centre_gate()') IS NULL THEN
    RAISE EXCEPTION 'NC-0140-RB-PRE-001: 20261104_0140 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

DROP TRIGGER IF EXISTS aaa_notification_centre_gate ON public.user_notifications;
DROP TRIGGER IF EXISTS aaa_notification_centre_gate ON public.admin_notifications;
DROP FUNCTION IF EXISTS public.notification_centre_gate();

COMMIT;
