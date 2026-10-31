-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0130 nightly stray-writer count. Unschedules the cron
-- job, drops the check function and the allow-list, and closes the alarm it
-- may have opened (so no stale alarm keeps paging). Refuses if not applied.
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
  IF to_regclass('public.notification_writer_allowlist') IS NULL THEN
    RAISE EXCEPTION 'NC-0130-RB-PRE-001: 20261104_0130 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notification-stray-writer-check';
SELECT public.ops_alarm_set('notif_stray_writer', false, 'stray-writer check removed', NULL);
DROP FUNCTION IF EXISTS public.notification_stray_writer_check();
DROP TABLE IF EXISTS public.notification_writer_allowlist;

COMMIT;
