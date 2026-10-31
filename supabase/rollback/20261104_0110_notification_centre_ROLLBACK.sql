-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0110 notification centre N2.
-- Removes exactly what 0110 created: four functions and three tables (the
-- registry, quiet hours, the centre log). It does NOT touch site_settings
-- (switch rows belong to the Owner) or any notification already written.
-- REFUSES while any notif_centre_* switch is "live" (a live group's makers
-- would be calling a function this drops) and when 0110 is not applied.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.notification_types') IS NULL THEN
    RAISE EXCEPTION 'NC-0110-RB-PRE-001: 20261104_0110 is not applied on this lane — nothing to roll back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.site_settings s
              WHERE s.key LIKE 'notif\_centre\_%' AND s.value = to_jsonb('live'::text)) THEN
    RAISE EXCEPTION 'NC-0110-RB-PRE-002: a notif_centre_* switch is live — switch it off (and move its makers back) first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname NOT LIKE 'notification\_centre\_%'
              AND p.prosrc ~ 'notification_centre_(emit|decide)') THEN
    RAISE EXCEPTION 'NC-0110-RB-PRE-003: another function calls the centre (N3 applied) — roll N3 back first';
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.notification_centre_replay(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.notification_centre_decide(text, uuid, uuid, uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.notification_centre_live(text);
DROP TABLE IF EXISTS public.notification_centre_log;
DROP TABLE IF EXISTS public.notification_quiet_hours;
DROP TABLE IF EXISTS public.notification_types;

COMMIT;
