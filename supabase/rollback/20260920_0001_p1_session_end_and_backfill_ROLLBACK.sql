-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · P1 · 20260920_0001 — session end + backfill
-- Undoes supabase/migrations/20260920_0001_p1_session_end_and_backfill.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES. Unschedules cron job 'p1-backfill-last-seen' and drops
-- public.record_session_end(text) and public.backfill_last_seen(). The apply
-- created all three and changed nothing else (no DDL on profiles, no grant on
-- any existing object), so removing them is the whole inverse. Values the two
-- functions already wrote into profiles.last_active_at / last_platform stay:
-- they are ordinary data, the same kind the client timer wrote, and there is
-- no pre-image to restore them to.
--
-- READ BEFORE RUNNING. If D2's client cut-over is live on the lane, rolling
-- this back leaves NO writer of last seen at all: the timer is gone and the
-- call that replaced it now fails (PGRST202, best-effort, never retried).
-- "Last seen X ago" then freezes for every member. Roll the client back
-- first, or accept that.
--
-- R-9 LANE GUARD — STAGING ONLY. Ruled by the Auditor for this unit
-- (Phase 2 kickoff command, 2026-09-27: "It is R-9 guarded"). The invoking
-- session asserts the lane; this file never sets it:
--
--     SET p32.lane = 'staging';      -- then run this file in the same session
--
-- apply-migration.yml sets it from its own lane guard (R-13). This constraint
-- is lifted when the Auditor rules that a production rollback of this unit is
-- wanted and the file is re-cut for it; until then a production rollback is
-- refused here, by design.
--
-- NOT RE-RUNNABLE. RB-PRE-002 refuses when there is nothing to undo, so a
-- second run is a sentence, not a silent success.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. ─────────────────────────────
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback is staging-only by the Auditor''s ruling for P1 (R-9). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

DO $preconditions$
BEGIN
  -- RB-PRE-001 · pg_cron is present (the unschedule below needs it).
  PERFORM 1 FROM pg_extension WHERE extname = 'pg_cron';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0001-RB-PRE-001: pg_cron is not installed' USING ERRCODE = 'raise_exception';
  END IF;

  -- RB-PRE-002 · there is something to undo.
  PERFORM 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('record_session_end', 'backfill_last_seen');
  IF NOT FOUND THEN
    PERFORM 1 FROM cron.job WHERE jobname = 'p1-backfill-last-seen';
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'P1-0001-RB-PRE-002: neither function nor the cron job exists — nothing to roll back'
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  -- RB-PRE-003 · only the signatures the apply created. Another overload of
  -- either name is not this file's to drop; refuse rather than guess.
  PERFORM 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND ((proname = 'record_session_end' AND pg_get_function_identity_arguments(oid) <> '_platform text')
       OR (proname = 'backfill_last_seen' AND pg_get_function_identity_arguments(oid) <> ''));
  IF FOUND THEN
    RAISE EXCEPTION
      'P1-0001-RB-PRE-003: an overload of record_session_end / backfill_last_seen exists that '
      '20260920_0001 did not create; refusing to touch it'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- The job first, so it cannot fire between the DROP and the COMMIT and fail.
SELECT cron.unschedule('p1-backfill-last-seen')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p1-backfill-last-seen');

DROP FUNCTION IF EXISTS public.backfill_last_seen();
DROP FUNCTION IF EXISTS public.record_session_end(text);

DO $postconditions$
BEGIN
  PERFORM 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('record_session_end', 'backfill_last_seen');
  IF FOUND THEN
    RAISE EXCEPTION 'P1-0001-RB-POST-001: a P1 function still exists' USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM cron.job WHERE jobname = 'p1-backfill-last-seen';
  IF FOUND THEN
    RAISE EXCEPTION 'P1-0001-RB-POST-002: cron job p1-backfill-last-seen still exists'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
