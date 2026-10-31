-- ═══════════════════════════════════════════════════════════════════════════
-- 20261102_0102 · Unit A — record the platform when a session STARTS.
--
-- OWNER: "Admin → Users: many members show neither App nor Website."
--
-- PROVEN CAUSE (PROBE_20261102_0100 + _0101, both lanes; fixture
-- supabase/tests/platform-badge/30_cause.sql, red before this file):
--   profiles.last_platform has exactly one live writer, record_session_end()
--   (20260920_0001 §2), and it runs only when a session ENDS — and then only
--   if last_active_at is more than 60 s old. Two consequences:
--     1. a member's chip cannot appear while they are using the app; it waits
--        for them to leave (the Owner's gate asks for it within 1 minute);
--     2. profiles.last_active_at is DEFAULT now() (20260330142754:3), so a new
--        member's row starts "seen" at sign-up with no platform; a session
--        that ends within 60 s of sign-up (e.g. the Android picker opened for
--        the profile photo backgrounds the app) matches no row, and
--        backfill_last_seen() (20260920_0001 §3) moves only the timestamp,
--        never the platform. Nothing else ever writes it.
--
-- THE FIX: public.record_session_platform(_platform) — called by the client
-- once when a signed-in session starts and when the app/tab comes back to the
-- foreground. It writes ONLY last_platform, and ONLY when it differs from what
-- is stored: at most one profiles row version per platform switch (the P1
-- dead-tuple concern stays solved — measured writes, not a timer).
-- last_active_at, record_session_end and backfill_last_seen are untouched.
--
-- docs/gates/P1-interface.md is the Auditor's frozen contract and is NOT
-- edited here: this adds a second server-side writer of last_platform beside
-- §2, on the Owner's instruction of 2026-10-30. Recorded for the Auditor.
--
-- Rollback: supabase/rollback/20261102_0102_record_session_platform_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261102_0102_record_session_platform.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('id', 'last_platform')) <> 2 THEN
    RAISE EXCEPTION 'A-0102-PRE-001: public.profiles.last_platform missing — refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'record_session_platform') THEN
    RAISE EXCEPTION 'A-0102-PRE-002: record_session_platform already exists — roll back first';
  END IF;
END
$pre$;

CREATE FUNCTION public.record_session_platform(_platform text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _user uuid;
BEGIN
  IF _platform IS NULL OR _platform NOT IN ('app', 'web') THEN
    RAISE EXCEPTION 'record_session_platform: _platform must be ''app'' or ''web'' (got %)',
      coalesce(quote_literal(_platform), 'NULL')
      USING ERRCODE = '22023';
  END IF;
  _user := auth.uid();
  IF _user IS NULL THEN
    RETURN;   -- signed out: nothing to record (same shape as record_session_end)
  END IF;
  -- Own row only; a no-op unless the platform changed.
  UPDATE public.profiles
     SET last_platform = _platform
   WHERE id = _user
     AND last_platform IS DISTINCT FROM _platform;
END
$fn$;

COMMENT ON FUNCTION public.record_session_platform(text) IS
  'Unit A (20261102_0102): the platform a signed-in session is on (app/web), written when the session starts or returns to the foreground. Own row only; writes only when it differs; 22023 on a bad value; signed out = no-op.';

REVOKE ALL ON FUNCTION public.record_session_platform(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_session_platform(text) TO authenticated, service_role;

DO $post$
DECLARE f oid := to_regprocedure('public.record_session_platform(text)');
BEGIN
  IF f IS NULL OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'A-0102-POST-001: function missing or not SECURITY DEFINER with search_path=""';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) x WHERE p.oid = f AND x.grantee = 0) THEN
    RAISE EXCEPTION 'A-0102-POST-002: EXECUTE must be authenticated + service_role only';
  END IF;
END
$post$;

COMMIT;
