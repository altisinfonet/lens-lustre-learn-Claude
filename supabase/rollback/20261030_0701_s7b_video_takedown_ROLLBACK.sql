-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261030_0701 — S7-b video takedown.
-- Drops the two RPCs and the audit table (with its trigger function). It does
-- NOT bring a taken-down video back (taken_down → ready is not a legal move),
-- does not reopen reports, and leaves queued purge rows (their 30-day hold
-- stays; 0700's rule still keeps a fixed video's files). If the audit trail
-- must be kept, copy video_takedown_audit out BEFORE running this.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb_preconditions$
BEGIN
  IF to_regprocedure('public.video_takedown(uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'S7B-0701-RB-001: 20261030_0701 is not applied (video_takedown missing)' USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

DROP FUNCTION public.video_report_dismiss(uuid, text);
DROP FUNCTION public.video_takedown(uuid, text, uuid);
DROP TABLE public.video_takedown_audit;
DROP FUNCTION public.tg_video_takedown_audit_append_only();

COMMIT;
