-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0180 · NOTIFICATION CENTRE N7 — a member sets their own quiet hours.
--
-- public.notification_quiet_hours (0110) is read by the centre's decision and,
-- with 0170, holds push during those hours for a group switched on. Members
-- had no way to fill it. These two functions are that way — own row only:
--   notif_quiet_hours_get()                      → starts, ends, tz (or none)
--   notif_quiet_hours_set(starts, ends, tz)      → saves; both NULL = turn off
-- A zone name must be one Postgres knows; start and end must differ. The
-- settings screen shows the row only with notif_centre_ui on (OFF on live).
--
-- Rollback: supabase/rollback/20261104_0180_notification_quiet_hours_member_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0180_notification_quiet_hours_member.sql
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
  IF to_regclass('public.notification_quiet_hours') IS NULL THEN
    RAISE EXCEPTION 'NC-0180-PRE-001: 20261104_0110 (notification_quiet_hours) is not applied on this lane';
  END IF;
  IF to_regprocedure('public.notif_quiet_hours_set(time, time, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'NC-0180-PRE-002: already applied — roll back first';
  END IF;
END
$pre$;

CREATE FUNCTION public.notif_quiet_hours_get()
RETURNS TABLE (starts time, ends time, tz text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT q.starts, q.ends, q.tz FROM public.notification_quiet_hours q WHERE q.user_id = auth.uid();
$fn$;

CREATE FUNCTION public.notif_quiet_hours_set(_starts time, _ends time, _tz text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _starts IS NULL AND _ends IS NULL THEN
    DELETE FROM public.notification_quiet_hours q WHERE q.user_id = _uid;
    RETURN false;                                     -- quiet hours off
  END IF;
  IF _starts IS NULL OR _ends IS NULL OR _starts = _ends THEN
    RAISE EXCEPTION 'choose a start and an end time that differ' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = _tz) THEN
    RAISE EXCEPTION 'unknown time zone' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.notification_quiet_hours (user_id, starts, ends, tz, updated_at)
  VALUES (_uid, _starts, _ends, _tz, now())
  ON CONFLICT (user_id) DO UPDATE SET starts = EXCLUDED.starts, ends = EXCLUDED.ends, tz = EXCLUDED.tz, updated_at = now();
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notif_quiet_hours_get() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notif_quiet_hours_set(time, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notif_quiet_hours_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_quiet_hours_set(time, time, text) TO authenticated;

COMMIT;
