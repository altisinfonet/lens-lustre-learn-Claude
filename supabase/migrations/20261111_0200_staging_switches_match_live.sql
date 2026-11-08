-- ═══════════════════════════════════════════════════════════════════════════
-- 20261111_0200 · STAGING ONLY · set staging's switches to what live has.
-- Owner rule (2026-10-17): staging is a clone of main's behaviour; only member
-- data and Google sign-in may differ. Measured 2026-11-08 (read-only
-- PROBE_switch_states_readonly: production run 42476747854, staging run
-- 42476756650, plus a public site_settings read on both sites):
--   live    · notif_centre_ui "on", the 7 notif_centre_* groups "live";
--             personal_feed / photo_set_v2 / photo_upload_resume = everyone;
--             site_settings photo_upload_resume "on".
--   staging · none of the notif_centre_* rows; those three features off;
--             site_settings photo_upload_resume "off".
-- So the Owner saw no new notification panel and no For you / Following tabs on
-- staging. This file copies live's values. Member lists are NOT copied (member
-- ids differ between the two databases). Every change is audited the same way
-- the admin buttons audit it (actor NULL = this file). Refuses on production.
-- Re-runnable: rows already at live's value are left alone, no audit row.
-- ROLLBACK: supabase/rollback/20261111_0200_staging_switches_match_live_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_switch_states_readonly.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION 'APPLY REFUSED — staging-only (p32.lane = %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END $g$;
SET LOCAL lock_timeout = '5s';

-- ── 1. notification centre switches (site_settings) ───────────────────────
WITH want(key, val) AS (VALUES
  ('notif_centre_ui',                   to_jsonb('on'::text)),
  ('notif_centre_likes_comments',       to_jsonb('live'::text)),
  ('notif_centre_follows_friends',      to_jsonb('live'::text)),
  ('notif_centre_competitions',         to_jsonb('live'::text)),
  ('notif_centre_announcements',        to_jsonb('live'::text)),
  ('notif_centre_account',              to_jsonb('live'::text)),
  ('notif_centre_wallet_support_roles', to_jsonb('live'::text)),
  ('notif_centre_admin_alerts',         to_jsonb('live'::text))),
changed AS (
  SELECT w.key, s.value AS old, w.val FROM want w
    LEFT JOIN public.site_settings s ON s.key = w.key
   WHERE s.value IS DISTINCT FROM w.val),
audit AS (
  INSERT INTO public.notification_centre_changes (changed_by, subject, field, old_value, new_value)
  SELECT NULL, key, 'switch', old, val FROM changed)
INSERT INTO public.site_settings (key, value)
SELECT key, val FROM changed
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 2. photo upload resume (site_settings, read by the client) ────────────
INSERT INTO public.site_settings (key, value) VALUES ('photo_upload_resume', to_jsonb('on'::text))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 3. feature switches (feature_access), audited like feature_set_mode ───
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, fa.feature, 'mode', fa.mode, 'everyone', '20261111_0200 staging matches live'
  FROM public.feature_access fa
 WHERE fa.feature IN ('personal_feed', 'photo_set_v2', 'photo_upload_resume') AND fa.mode <> 'everyone';
UPDATE public.feature_access
   SET mode = 'everyone', note = '20261111_0200 staging matches live', updated_by = NULL, updated_at = now()
 WHERE feature IN ('personal_feed', 'photo_set_v2', 'photo_upload_resume') AND mode <> 'everyone';

-- ── 4. check ──────────────────────────────────────────────────────────────
DO $p$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.site_settings
   WHERE (key = 'notif_centre_ui' AND value = to_jsonb('on'::text))
      OR (key LIKE 'notif_centre\_%' AND key <> 'notif_centre_ui' AND value = to_jsonb('live'::text));
  IF n <> 8 THEN RAISE EXCEPTION 'STG-0200: % of 8 notification switches at live value', n; END IF;
  SELECT count(*) INTO n FROM public.feature_access
   WHERE feature IN ('personal_feed', 'photo_set_v2', 'photo_upload_resume') AND mode = 'everyone';
  IF n <> 3 THEN RAISE EXCEPTION 'STG-0200: % of 3 features set to everyone (a feature row is missing?)', n; END IF;
  RAISE NOTICE 'STG-0200 applied: staging switches match live (8 notification, 3 features, photo_upload_resume on)';
END $p$;
COMMIT;
