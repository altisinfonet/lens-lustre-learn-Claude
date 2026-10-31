-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261005_0006 — VID-4 copyright music check
-- Removes the music-check functions (upload-complete, remedy, worker, library
-- RPCs). Nothing member-owned is touched: videos, versions and the append-only
-- check history (0005's tables) stay as they are; a video left in 'checking'
-- stays there (never published — the 0005 gate still holds), and is moved on
-- once 0006 is re-applied. KEPT, by design: music_library_audit (a record; RLS
-- on, no API grant). A re-apply reuses it.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires 0006 to be applied.
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
BEGIN
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'VID4-0006-RB-PRE-001: 20261005_0006 is not applied — nothing to roll back' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DROP FUNCTION public.video_mark_uploaded(uuid, integer, text);
DROP FUNCTION public.video_new_version(uuid, text, text, bigint, numeric, boolean, jsonb, uuid, jsonb);
DROP FUNCTION public.music_check_record_result(uuid, text, text, numeric, jsonb, text);
DROP FUNCTION public.music_check_due(integer);
DROP FUNCTION public.music_check_overdue(interval);
DROP FUNCTION public.music_check_retry_after(integer);
DROP FUNCTION public.music_library_add(text, text, numeric, text, text, text, text, text, text);
DROP FUNCTION public.music_library_set_active(uuid, boolean, text);
DROP FUNCTION public.music_library_set_fingerprints(uuid, text[]);
DROP TRIGGER tg_music_library_audit_append_only ON public.music_library_audit;
DROP FUNCTION public.tg_music_library_audit_append_only();

DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
               AND proname IN ('video_mark_uploaded', 'video_new_version', 'music_check_record_result', 'music_check_due',
                               'music_check_overdue', 'music_check_retry_after', 'music_library_add', 'music_library_set_active',
                               'music_library_set_fingerprints', 'tg_music_library_audit_append_only')) THEN
    RAISE EXCEPTION 'VID4-0006-RB-POST-001: a music-check function remains' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID4-0006 ROLLBACK: music-check functions removed; videos, checks and the library audit kept';
END
$postconditions$;

COMMIT;
