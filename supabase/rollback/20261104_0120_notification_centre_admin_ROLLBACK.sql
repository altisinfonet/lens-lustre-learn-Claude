-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0120 notification centre N6 (admin functions).
-- Removes the eight functions, the change-history table and the wording_en
-- column. Switch rows in site_settings are NOT touched (the Owner's), and bell
-- rows already written (incl. tests) stay. Refuses when 0120 is not applied.
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
  IF to_regclass('public.notification_centre_changes') IS NULL THEN
    RAISE EXCEPTION 'NC-0120-RB-PRE-001: 20261104_0120 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.notification_centre_send_test(text);
DROP FUNCTION IF EXISTS public.admin_notif_member_settings(uuid);
DROP FUNCTION IF EXISTS public.admin_notif_switch_set(text, text, uuid[]);
DROP FUNCTION IF EXISTS public.admin_notif_switches();
DROP FUNCTION IF EXISTS public.admin_notif_history(text, integer);
DROP FUNCTION IF EXISTS public.admin_notif_type_update(text, jsonb);
DROP FUNCTION IF EXISTS public.admin_notif_types();
DROP FUNCTION IF EXISTS public.notif_admin_or_raise();
DROP TABLE IF EXISTS public.notification_centre_changes;
ALTER TABLE public.notification_types DROP COLUMN IF EXISTS wording_en;

COMMIT;
