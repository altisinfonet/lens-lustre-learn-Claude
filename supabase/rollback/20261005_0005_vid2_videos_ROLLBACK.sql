-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261005_0005 — VID-2 videos (tables, state machine, gate, RLS,
-- limits, 30-day purge).
--
-- MEMBER DATA IS NEVER DROPPED BLIND. RB-PRE-003 refuses while ANY video,
-- version, check, link, library track or undone purge-queue row exists: then
-- this file is not the tool. The kill switch is VID-7's, with no data loss:
--     SELECT public.feature_set_mode('video_posts', 'off');
--     SELECT public.feature_set_mode('video_ads', 'off');
-- (video_begin_upload refuses at once — VID-UP-003 — and nothing else creates
-- a video). Only an EMPTY unit is removed, tables included, so a re-apply
-- starts clean.
--
-- ORDER: roll back 20261005_0006 (music check) first — RB-PRE-002 checks it.
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires 0005 to be applied.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _n bigint;
BEGIN
  IF to_regclass('public.videos') IS NULL OR to_regprocedure('public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'VID2-0005-RB-PRE-001: 20261005_0005 is not applied — nothing to roll back' USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
               AND proname IN ('video_mark_uploaded', 'music_check_record_result', 'video_new_version')) THEN
    RAISE EXCEPTION 'VID2-0005-RB-PRE-002: 20261005_0006 (music check) is applied — roll it back first' USING ERRCODE = 'raise_exception';
  END IF;
  -- Lock the tables so no row can arrive between the count and the drop.
  LOCK TABLE public.videos, public.video_versions, public.video_music_checks, public.music_library_tracks,
             public.post_videos, public.ad_videos, public.video_r2_purge_queue IN ACCESS EXCLUSIVE MODE;
  SELECT (SELECT count(*) FROM public.videos) + (SELECT count(*) FROM public.video_versions)
       + (SELECT count(*) FROM public.video_music_checks) + (SELECT count(*) FROM public.music_library_tracks)
       + (SELECT count(*) FROM public.post_videos) + (SELECT count(*) FROM public.ad_videos)
       + (SELECT count(*) FROM public.video_r2_purge_queue WHERE done_at IS NULL)
    INTO _n;
  IF _n > 0 THEN
    RAISE EXCEPTION 'VID2-0005-RB-PRE-003: % video row(s) exist — member data is never dropped by a rollback. '
                    'Turn video_posts / video_ads Off instead (feature_set_mode), which stops every upload with no loss.', _n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'video-housekeeping';

DROP TRIGGER trg_videos_keep_post_categories ON public.posts;
DROP FUNCTION public.tg_posts_video_keeps_categories();
DROP FUNCTION public.video_housekeeping(interval, integer);
DROP FUNCTION public.video_delete(uuid);
DROP FUNCTION public.video_begin_upload(text, text, bigint, numeric, boolean, uuid, jsonb);
DROP FUNCTION public.video_validate_version(text, text, bigint, numeric, boolean, jsonb);
-- empty (RB-PRE-003, under lock): links first, then the videos.
DROP TABLE public.post_videos;
DROP TABLE public.ad_videos;
DROP TABLE public.video_r2_purge_queue;
ALTER TABLE public.videos DROP CONSTRAINT videos_music_check_fk;
DROP TABLE public.video_music_checks;
DROP TABLE public.video_versions;
DROP TABLE public.videos;
DROP TABLE public.music_library_tracks;
DROP FUNCTION public.video_visible(uuid);
DROP FUNCTION public.tg_videos_state_guard();
DROP FUNCTION public.tg_videos_insert_guard();
DROP FUNCTION public.tg_video_versions_guard();
DROP FUNCTION public.tg_video_music_checks_append_only();
DROP FUNCTION public.tg_post_videos_link_guard();
DROP FUNCTION public.tg_ad_videos_link_guard();

DO $postconditions$
BEGIN
  IF to_regclass('public.videos') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'video\_%' OR proname LIKE 'tg\_video%'
                                                                                      OR proname IN ('tg_post_videos_link_guard', 'tg_ad_videos_link_guard', 'tg_posts_video_keeps_categories')))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.posts'::regclass AND tgname = 'trg_videos_keep_post_categories')
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'video-housekeeping') THEN
    RAISE EXCEPTION 'VID2-0005-RB-POST-001: a video object remains' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID2-0005 ROLLBACK: the empty video unit is removed; feature switches (0004) untouched';
END
$postconditions$;

COMMIT;
