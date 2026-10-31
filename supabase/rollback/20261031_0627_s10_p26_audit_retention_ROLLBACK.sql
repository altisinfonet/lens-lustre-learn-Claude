-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0627 — S10 P26 retention. Unschedules the job, moves
-- every archived row back into public.db_audit_logs (refuses if one would
-- collide with a live id), drops the procedure and schema p26_archive.
-- ONE TRANSACTION.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted as staging or production';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $rb$
DECLARE n bigint; back bigint;
BEGIN
  IF to_regclass('p26_archive.db_audit_logs') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED 0627 — p26_archive.db_audit_logs missing (0627 never applied here?)';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p26-audit-retention') THEN
    PERFORM cron.unschedule('p26-audit-retention');
  END IF;
  SELECT count(*) INTO n FROM p26_archive.db_audit_logs a JOIN public.db_audit_logs l ON l.id = a.id;
  IF n > 0 THEN RAISE EXCEPTION 'ROLLBACK REFUSED 0627 — % archived id(s) also exist in the live table', n; END IF;
  SELECT count(*) INTO n FROM p26_archive.db_audit_logs;
  INSERT INTO public.db_audit_logs (id, table_name, operation, row_id, old_data, new_data, changed_by, created_at)
  SELECT id, table_name, operation, row_id, old_data, new_data, changed_by, created_at FROM p26_archive.db_audit_logs;
  GET DIAGNOSTICS back = ROW_COUNT;
  IF back <> n THEN RAISE EXCEPTION 'ROLLBACK FAILED 0627 — moved back % of % rows', back, n; END IF;
  RAISE NOTICE 'ROLLBACK 0627 — % archived row(s) moved back', back;
END
$rb$;

DROP PROCEDURE public.p26_move_old_audit_rows(interval, integer, integer);
DROP SCHEMA p26_archive CASCADE;

DO $post$
BEGIN
  IF to_regnamespace('p26_archive') IS NOT NULL OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p26-audit-retention') THEN
    RAISE EXCEPTION 'ROLLBACK FAILED 0627 — archive schema or cron job still present';
  END IF;
  RAISE NOTICE 'ROLLBACK 0627 POST PASS';
END
$post$;

COMMIT;
