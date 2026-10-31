-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261102_0102 record_session_platform.
-- Drops the one function 0102 created. Platforms it already wrote stay in
-- profiles.last_platform — they are true records of where a member was.
-- Clients calling it afterwards get PGRST202, are best-effort and never retry.
-- Refuses when 0102 is not applied.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regprocedure('public.record_session_platform(text)') IS NULL THEN
    RAISE EXCEPTION 'A-0102-RB-PRE-001: 20261102_0102 is not applied on this lane — nothing to roll back';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';
DROP FUNCTION public.record_session_platform(text);

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'record_session_platform') THEN
    RAISE EXCEPTION 'A-0102-RB-POST-001: record_session_platform still present';
  END IF;
END
$post$;

COMMIT;
