-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261005_0004 — VID-7 feature switches
-- Removes every function and the audit trigger, so nothing can read or change
-- a switch, and every caller that needs feature_allowed() refuses (the video
-- RPCs of 20261005_0005 must be rolled back FIRST; RB-PRE-002 checks that).
-- KEPT, by design: the three tables with their rows — the modes, the member
-- lists and the audit trail are records, never dropped blind. They have RLS
-- on and no API grant, so nothing reaches them. A re-apply of 0004 reuses
-- them and resets every mode to 'off' (audited).
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires 0004 to be applied.
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
  IF to_regprocedure('public.feature_allowed(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'VID7-0004-RB-PRE-001: 20261005_0004 is not applied — nothing to roll back' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID7-0004-RB-PRE-002: 20261005_0005 (videos) still calls feature_allowed() — roll it back first' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DROP FUNCTION public.feature_member_search(text, integer);
DROP FUNCTION public.feature_admin_state();
DROP FUNCTION public.feature_remove_member(text, uuid, text);
DROP FUNCTION public.feature_add_member(text, uuid, text);
DROP FUNCTION public.feature_set_mode(text, text, text);
DROP FUNCTION public.feature_allowed_me(text);
DROP FUNCTION public.feature_allowed(text, uuid);
DROP FUNCTION public.music_check_key_configured();
DROP TRIGGER tg_feature_audit_append_only ON public.feature_access_audit;
DROP FUNCTION public.tg_feature_audit_append_only();

DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
               AND proname IN ('feature_allowed', 'feature_allowed_me', 'feature_set_mode', 'feature_add_member',
                               'feature_remove_member', 'feature_admin_state', 'feature_member_search', 'music_check_key_configured')) THEN
    RAISE EXCEPTION 'VID7-0004-RB-POST-001: a feature function remains' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID7-0004-RB: switches removed; the tables (modes, lists, audit trail) are kept, closed to the API';
END
$postconditions$;

COMMIT;
