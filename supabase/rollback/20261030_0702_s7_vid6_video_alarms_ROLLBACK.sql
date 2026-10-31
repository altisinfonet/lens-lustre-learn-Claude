-- ROLLBACK for 20261030_0702_s7_vid6_video_alarms.sql — removes the VID-6 video alarms.
-- Drops ONLY what that migration created: the ops-video-alarms cron job, its two
-- functions and the video_storage_alarm_bytes column. Open 'video-storage' /
-- 'video-music-overdue' alarms are CLOSED (not deleted), so alarm-relay.yml closes
-- their ALARM issues with "recovered"; the rest of ops alarms is untouched.
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted' USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $c$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-video-alarms') THEN
    PERFORM cron.unschedule('ops-video-alarms');
  END IF;
END $c$;

UPDATE public.ops_alarms SET closed_at = now(), last_seen_at = now()
 WHERE alarm_key IN ('video-storage', 'video-music-overdue') AND closed_at IS NULL;

DROP FUNCTION IF EXISTS public.ops_video_alarms();
DROP FUNCTION IF EXISTS public.ops_video_storage_bytes();
ALTER TABLE public.ops_alarm_settings DROP COLUMN IF EXISTS video_storage_alarm_bytes;

DO $post$ BEGIN
  IF to_regprocedure('public.ops_video_alarms()') IS NOT NULL
     OR to_regprocedure('public.ops_video_storage_bytes()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-video-alarms')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'ops_alarm_settings' AND column_name = 'video_storage_alarm_bytes') THEN
    RAISE EXCEPTION 'VID6-0702-ROLLBACK-POST: objects remain';
  END IF;
END $post$;

COMMIT;
