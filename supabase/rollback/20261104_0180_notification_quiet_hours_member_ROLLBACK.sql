-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0180 member quiet hours. Drops the two functions. Saved
-- quiet hours stay in notification_quiet_hours (0110 owns that table).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

DO $pre$
BEGIN
  IF to_regprocedure('public.notif_quiet_hours_set(time, time, text)') IS NULL THEN
    RAISE EXCEPTION 'NC-0180-RB-PRE-001: 20261104_0180 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.notif_quiet_hours_set(time, time, text);
DROP FUNCTION IF EXISTS public.notif_quiet_hours_get();

COMMIT;
