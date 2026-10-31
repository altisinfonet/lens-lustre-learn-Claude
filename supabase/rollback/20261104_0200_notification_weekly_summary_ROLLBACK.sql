-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0200 weekly summary. Unschedules the Monday job, drops
-- the function and the per-week record. E-mails already queued are not
-- recalled (their email_send_log rows stay as the record).
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
  IF to_regclass('public.notification_weekly_summaries') IS NULL THEN
    RAISE EXCEPTION 'NC-0200-RB-PRE-001: 20261104_0200 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notification-weekly-summary';
DROP FUNCTION IF EXISTS public.notification_weekly_summary_send();
DROP TABLE IF EXISTS public.notification_weekly_summaries;

COMMIT;
