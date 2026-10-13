-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · VID-1 20261013_0006 — finished converter rows / 30-day cleanup.
-- Puts public.video_source_housekeeping() back to its 20261012_0002 body
-- exactly, then removes what 0006 created: the cron job
-- 'video-source-unposted-cleanup', public.video_source_unposted_cleanup(), the
-- trigger tg_video_sources_owner_gone and its function.
--
-- WHAT COMES BACK WITH IT (read before running):
--   • every finished ('done') row older than 2 days is purged again by the next
--     5-minute housekeeping run, posted or not — a member who returns after 2
--     days is told the video cannot be found. The NOTICE counts those rows.
--     Switch Admin → Video Conversion on this lane back to "device" FIRST.
--   • unposted converted videos are no longer removed, and a deleted account's
--     converted files are no longer queued.
-- WHAT DOES NOT COME BACK: videos the cleanup already removed (their files
-- are queued in video_r2_purge_queue; those rows are left as they are).
--
-- ORDER: this file BEFORE supabase/rollback/20261012_0002_vid1_converter_sources_ROLLBACK.sql
-- (0002's rollback drops video_sources; run first, it would leave this file's
-- function and its hourly job pointing at nothing).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.video_sources') IS NULL OR to_regprocedure('public.video_source_housekeeping(integer)') IS NULL THEN
    RAISE EXCEPTION 'VID-RET-RB-PRE-001: the converter queue is not on this lane — nothing to roll back';
  END IF;
  -- Never overwrite a LATER migration's housekeeping body: only this file's own goes back to 0002's.
  IF position('VID-RET-0006' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VID-RET-RB-PRE-002: video_source_housekeeping() is not the 20261013_0006 body — 0006 is not applied, or a later migration changed it; roll that back first';
  END IF;
  RAISE NOTICE 'VID-RET-RB: % finished row(s) older than 2 days and not released will be purged by the next housekeeping run',
    (SELECT count(*) FROM public.video_sources s
      WHERE s.status = 'done' AND s.updated_at < now() - interval '2 days'
        AND NOT EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = s.video_id)
        AND NOT EXISTS (SELECT 1 FROM public.ad_videos av WHERE av.video_id = s.video_id)
        AND EXISTS (SELECT 1 FROM public.videos v WHERE v.id = s.video_id AND v.state NOT IN ('deleted', 'failed', 'taken_down')));
END
$pre$;

-- ── 1. the hourly job, the cleanup, the trigger ─────────────────────────────
DO $unschedule$
DECLARE
  _j bigint;
BEGIN
  FOR _j IN SELECT jobid FROM cron.job WHERE jobname = 'video-source-unposted-cleanup' LOOP
    PERFORM cron.unschedule(_j);
  END LOOP;
END
$unschedule$;
DROP TRIGGER IF EXISTS tg_video_sources_owner_gone ON public.video_sources;
DROP FUNCTION IF EXISTS public.tg_video_sources_owner_gone();
DROP FUNCTION IF EXISTS public.video_source_unposted_cleanup(interval, integer);

-- ── 2. housekeeping, back to the 20261012_0002 body (CREATE OR REPLACE keeps its ACL) ──
CREATE OR REPLACE FUNCTION public.video_source_housekeeping(_batch integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _x        record;
  _expired  bigint := 0;
  _stale    bigint := 0;
  _waited   bigint := 0;
  _purged   bigint;
  _events   bigint;
BEGIN
  IF _batch IS NULL OR _batch < 1 THEN
    RAISE EXCEPTION 'video_source_housekeeping: _batch must be at least 1' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR _x IN SELECT id, owner_id, attempts, video_id FROM public.video_sources
             WHERE status = 'converting' AND lease_until <= now() ORDER BY lease_until LIMIT _batch FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.video_source_expire(_x.id, _x.owner_id, _x.attempts, _x.video_id);
    _expired := _expired + 1;
  END LOOP;
  FOR _x IN SELECT id, owner_id FROM public.video_sources
             WHERE status = 'awaiting_upload' AND created_at < now() - interval '24 hours'
             ORDER BY created_at LIMIT _batch FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.video_sources SET status = 'failed', error = public.video_source_reason_text('source_missing') WHERE id = _x.id;
    PERFORM public.video_source_log(_x.id, _x.owner_id, 'failed', 'upload never finished');
    _stale := _stale + 1;
  END LOOP;
  FOR _x IN SELECT id, owner_id, purpose FROM public.video_sources
             WHERE status = 'queued' AND queued_at < now() - interval '48 hours'
             ORDER BY queued_at LIMIT _batch FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.video_sources SET status = 'failed',
           error = public.video_source_reason_text(CASE WHEN public.video_owner_may(_x.owner_id, _x.purpose) THEN 'converter_away' ELSE 'not_allowed' END)
     WHERE id = _x.id;
    PERFORM public.video_source_log(_x.id, _x.owner_id, 'failed', 'queued 48 h, never claimed');
    _waited := _waited + 1;
  END LOOP;
  DELETE FROM public.video_sources
   WHERE id IN (SELECT id FROM public.video_sources WHERE status IN ('done', 'failed', 'cancelled')
                   AND updated_at < now() - interval '2 days' ORDER BY updated_at LIMIT _batch);
  GET DIAGNOSTICS _purged = ROW_COUNT;
  PERFORM set_config('vid.source_purge', 'on', true);
  DELETE FROM public.video_source_events
   WHERE id IN (SELECT id FROM public.video_source_events WHERE at < now() - interval '90 days' ORDER BY at LIMIT _batch);
  GET DIAGNOSTICS _events = ROW_COUNT;
  PERFORM set_config('vid.source_purge', 'off', true);
  RETURN jsonb_build_object('lease_expired', _expired, 'upload_abandoned', _stale, 'queue_timed_out', _waited, 'purged', _purged, 'events_purged', _events);
END;
$fn$;

DO $post$
BEGIN
  IF position('VID-RET-0006' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure)) > 0
     OR position('WHERE id IN (SELECT id FROM public.video_sources WHERE status IN (''done'', ''failed'', ''cancelled'')'
                 IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VID-RET-RB-POST-001: video_source_housekeeping() is not back to the 20261012_0002 body';
  END IF;
  IF to_regprocedure('public.video_source_unposted_cleanup(interval,integer)') IS NOT NULL
     OR to_regprocedure('public.tg_video_sources_owner_gone()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.video_sources'::regclass AND tgname = 'tg_video_sources_owner_gone')
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'video-source-unposted-cleanup') THEN
    RAISE EXCEPTION 'VID-RET-RB-POST-002: something 0006 created is still there';
  END IF;
  IF has_function_privilege('anon', 'public.video_source_housekeeping(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_source_housekeeping(integer)', 'EXECUTE')
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-housekeeping' AND schedule = '*/5 * * * *') <> 1 THEN
    RAISE EXCEPTION 'VID-RET-RB-POST-003: housekeeping is callable by an API role, or its 5-minute job is not in place';
  END IF;
  RAISE NOTICE 'VID-RET-RB: 20261013_0006 rolled back — housekeeping is the 20261012_0002 body; the cleanup, its job and the owner-gone trigger are gone';
END
$post$;

COMMIT;
