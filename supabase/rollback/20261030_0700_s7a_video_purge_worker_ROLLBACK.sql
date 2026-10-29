-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261030_0700 — S7-a video purge worker.
-- Removes exactly what 20261030_0700 added: the cron job, the delete trigger,
-- the five functions, the index, the constraints and the six worker columns.
-- Queue ROWS stay (old and new), so nothing queued is forgotten; their
-- worker bookkeeping (lease, attempts, outcome) is dropped with the columns.
-- No file is touched. Roll back 20261030_0701 first if it is applied.
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
  IF to_regprocedure('public.video_purge_claim(integer)') IS NULL THEN
    RAISE EXCEPTION 'S7A-0700-RB-001: 20261030_0700 is not applied (video_purge_claim missing)' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.video_takedown(uuid,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'S7A-0700-RB-002: roll back 20261030_0701 first (video_takedown exists)' USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

SELECT cron.unschedule('video-orphan-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'video-orphan-sweep');

DROP TRIGGER tg_videos_queue_purge ON public.videos;
DROP FUNCTION public.tg_videos_queue_purge();
DROP FUNCTION public.video_orphan_sweep(interval, integer, timestamptz);
DROP FUNCTION public.video_purge_done(bigint, integer, text);
DROP FUNCTION public.video_purge_claim(integer);
DROP FUNCTION public.video_purge_worker_ok();
DROP FUNCTION public.video_purge_referenced(uuid, uuid, text);

DROP INDEX public.idx_video_r2_purge_queue_due;
ALTER TABLE public.video_r2_purge_queue
  DROP CONSTRAINT video_r2_purge_queue_prefix_shape,
  DROP CONSTRAINT video_r2_purge_queue_error_len,
  DROP CONSTRAINT video_r2_purge_queue_closed,
  DROP CONSTRAINT video_r2_purge_queue_outcome;
ALTER TABLE public.video_r2_purge_queue
  DROP COLUMN objects_deleted,
  DROP COLUMN outcome,
  DROP COLUMN last_error,
  DROP COLUMN attempts,
  DROP COLUMN claimed_until,
  DROP COLUMN not_before;

COMMIT;
