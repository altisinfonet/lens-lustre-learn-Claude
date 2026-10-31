-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261029_0100 — S3-b derivative ladder RPCs.
-- Drops exactly the seven functions 20261029_0100 created. It does NOT touch
-- media_objects.derivatives: rung keys already recorded there stay (they name
-- stored objects; the orphan sweep keeps counting them as referenced) and no
-- object is deleted. Run AFTER the 0101 / 0102 rollbacks if those are applied.
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
  IF to_regprocedure('public.media_derivative_queue(integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'S3B-0100-RB-001: 20261029_0100 is not applied (media_derivative_queue missing)' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.post_media_resolved_for(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'S3B-0100-RB-002: roll back 20261029_0101 first (post_media_resolved_for exists)' USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

DROP FUNCTION public.media_derivative_record(uuid, text, integer, text);
DROP FUNCTION public.media_derivative_target(uuid, text, integer);
DROP FUNCTION public.media_derivative_source(uuid);
DROP FUNCTION public.media_derivative_queue(integer, uuid);
DROP FUNCTION public.media_derivative_worker_ok();
DROP FUNCTION public.media_derivative_key(uuid, uuid, text, integer);
DROP FUNCTION public.media_rung_dims(integer, integer, integer);

COMMIT;
