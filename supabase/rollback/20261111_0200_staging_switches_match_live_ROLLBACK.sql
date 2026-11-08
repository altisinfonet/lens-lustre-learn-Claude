-- ROLLBACK · 20261111_0200 · STAGING ONLY · put staging's switches back to
-- what they were before 20261111_0200 (measured 2026-11-08): no notif_centre_*
-- rows, personal_feed / photo_set_v2 / photo_upload_resume off,
-- site_settings photo_upload_resume "off". Audited. Refuses on production.
BEGIN;
DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — staging-only (p32.lane = %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END $g$;
SET LOCAL lock_timeout = '5s';

WITH gone AS (
  DELETE FROM public.site_settings WHERE key LIKE 'notif_centre\_%' RETURNING key, value)
INSERT INTO public.notification_centre_changes (changed_by, subject, field, old_value, new_value)
SELECT NULL, key, 'switch', value, NULL FROM gone;

UPDATE public.site_settings SET value = to_jsonb('off'::text) WHERE key = 'photo_upload_resume';

INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, feature, 'mode', mode, 'off', '20261111_0200 rollback'
  FROM public.feature_access
 WHERE feature IN ('personal_feed', 'photo_set_v2', 'photo_upload_resume') AND mode <> 'off';
UPDATE public.feature_access SET mode = 'off', note = '20261111_0200 rollback', updated_by = NULL, updated_at = now()
 WHERE feature IN ('personal_feed', 'photo_set_v2', 'photo_upload_resume') AND mode <> 'off';

DO $p$ BEGIN RAISE NOTICE 'STG-0200 rolled back: staging switches off again'; END $p$;
COMMIT;
