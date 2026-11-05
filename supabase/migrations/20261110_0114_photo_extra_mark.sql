-- ═══════════════════════════════════════════════════════════════════════════
-- Photo clean-up · 20261110_0114 — QUEUE the old extra copies (photo_extra_mark,
-- 20261110_0113) and re-check every queued row against the reference scan.
-- Lanes: staging and production. RE-RUNNABLE: each run queues what has become
-- eligible and turns any queued key that something names now into 'kept'.
-- Moves nothing, deletes nothing (photo-hold.yml does the moving).
-- Its own file so the scan never runs while 0113's ALTER holds photo_retire.
-- ROLLBACK: none needed — 0113's rollback removes every post_extra row.
-- PROBE:    supabase/migrations/PROBE_20261110_0113_photo_extra_hold.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $mark$
DECLARE _r jsonb;
BEGIN
  IF to_regprocedure('public.photo_extra_mark()') IS NULL THEN
    RAISE EXCEPTION 'EX-0114-PRE-001: 20261110_0113 is not applied on this lane (photo_extra_mark is missing)';
  END IF;
  _r := public.photo_extra_mark();
  RAISE NOTICE 'EX-0114 on % (CDN %): %', current_setting('p32.lane'), public.photo_retire_cdn(), _r;
END
$mark$;

COMMIT;
