-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0220 admin announcements. Drops the function and the
-- registry row. Announcements already in members' bells stay (they are
-- ordinary notification rows); the change history keeps its records.
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
  IF to_regprocedure('public.admin_notif_announce(text, text, text, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'NC-0220-RB-PRE-001: 20261104_0220 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

DROP FUNCTION public.admin_notif_announce(text, text, text, uuid[]);
DELETE FROM public.notification_types WHERE type = 'admin_announcement';

COMMIT;
