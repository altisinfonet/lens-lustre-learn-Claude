-- ═══════════════════════════════════════════════════════════════════════════
-- S5 · 20261103_0601 — Admin → Uploads → Upload Resume (the Owner's own switch)
-- Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT. `photo_upload_resume` joins the admin feature switches (VID-7,
-- public.feature_access): Off / Selected members / All members, the same
-- screen, the same admin-only feature_* RPCs, the same audit rows.
--
-- WHAT THE APP READS DOES NOT CHANGE. Every build since 1.2.29 reads
-- site_settings `photo_upload_resume` and treats exactly "on" as on. A trigger
-- on feature_access writes that row from the mode, in the same transaction as
-- feature_set_mode's audit row:
--     everyone → "on"        (what 1.2.29+ already read: no app update needed)
--     selected → "selected"  (old builds compare === "on" → OFF, the safe side;
--                             newer builds ask feature_allowed_me for the member)
--     off      → "off"
-- Member list changes need no write: "selected" is answered per member by
-- feature_allowed('photo_upload_resume', uid).
--
-- NOTHING IS SWITCHED ON. The new row is seeded from the lane's CURRENT value:
-- "on" → everyone, anything else (or no row) → off. On production today that
-- is off (PROBE first); the seed only makes the screen tell the truth.
--
-- OBJECTS: feature_access_feature_check widened by one key; one feature_access
-- row + one audit row; trigger fn public.tg_photo_resume_to_site_setting() and
-- trigger trg_photo_resume_to_site_setting on public.feature_access.
-- NOT RE-RUNNABLE: PRE-002 refuses once the row or the function exists.
-- ROLLBACK: supabase/rollback/20261103_0601_s5_photo_resume_admin_switch_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261103_0601_s5_photo_resume_admin_switch.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE _def text;
BEGIN
  -- PRE-001 · what this file extends.
  IF to_regclass('public.feature_access') IS NULL OR to_regclass('public.feature_access_audit') IS NULL
     OR to_regclass('public.site_settings') IS NULL
     OR to_regprocedure('public.feature_set_mode(text,text,text)') IS NULL
     OR to_regprocedure('public.feature_allowed_me(text)') IS NULL THEN
    RAISE EXCEPTION 'S5-0601-PRE-001: feature_access, its audit, site_settings or the feature_* RPCs are missing' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied already.
  IF EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'photo_upload_resume')
     OR to_regprocedure('public.tg_photo_resume_to_site_setting()') IS NOT NULL THEN
    RAISE EXCEPTION 'S5-0601-PRE-002: photo_upload_resume is already a feature switch — 20261103_0601 is applied' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · the switch list is exactly the one this file extends (20261029_0101);
  -- otherwise stop rather than drop someone else's key.
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
   WHERE conrelid = 'public.feature_access'::regclass AND conname = 'feature_access_feature_check';
  -- Exact text (review #652): a key added by another unit and not yet seeded must stop this file.
  IF _def IS DISTINCT FROM 'CHECK ((feature = ANY (ARRAY[''video_posts''::text, ''video_ads''::text, ''copyright_music_check''::text, ''personal_feed''::text, ''media_ladder_feed''::text, ''media_private_photos''::text])))' THEN
    RAISE EXCEPTION 'S5-0601-PRE-003: feature_access_feature_check is not the 20261029_0101 list (read: %)', coalesce(_def, '<none>')
      USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feature_access
              WHERE feature NOT IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed',
                                    'media_ladder_feed', 'media_private_photos')) THEN
    RAISE EXCEPTION 'S5-0601-PRE-003: feature_access holds a feature this file does not know' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the key ──────────────────────────────────────────────────────────────
ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check;
ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
  CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed',
                     'media_ladder_feed', 'media_private_photos', 'photo_upload_resume'));

-- ── 2. mode → site_settings, in the same transaction ───────────────────────
CREATE FUNCTION public.tg_photo_resume_to_site_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  INSERT INTO public.site_settings (key, value, updated_at, updated_by)
  VALUES ('photo_upload_resume',
          to_jsonb((CASE NEW.mode WHEN 'everyone' THEN 'on' WHEN 'selected' THEN 'selected' ELSE 'off' END)::text),
          now(), NEW.updated_by)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_photo_resume_to_site_setting() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_photo_resume_to_site_setting
  AFTER INSERT OR UPDATE OF mode ON public.feature_access
  FOR EACH ROW WHEN (NEW.feature = 'photo_upload_resume')
  EXECUTE FUNCTION public.tg_photo_resume_to_site_setting();

-- ── 3. the row, seeded from the lane's current value (never turned on here) ─
WITH cur AS (
  SELECT coalesce((SELECT s.value #>> '{}' FROM public.site_settings s WHERE s.key = 'photo_upload_resume'), '') AS v
), seeded AS (
  INSERT INTO public.feature_access (feature, mode)
  SELECT 'photo_upload_resume', CASE cur.v WHEN 'on' THEN 'everyone' ELSE 'off' END FROM cur
  RETURNING mode
)
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, 'photo_upload_resume', 'mode', NULL, seeded.mode,
       '20261103_0601: switch created from site_settings (' || coalesce(nullif(cur.v, ''), 'no row') || ')'
  FROM seeded, cur;

DO $postconditions$
DECLARE _mode text; _stored text;
BEGIN
  SELECT mode INTO _mode FROM public.feature_access WHERE feature = 'photo_upload_resume';
  SELECT s.value #>> '{}' INTO _stored FROM public.site_settings s WHERE s.key = 'photo_upload_resume';
  IF _mode IS NULL OR _mode NOT IN ('off', 'everyone') THEN
    RAISE EXCEPTION 'S5-0601-POST-001: photo_upload_resume not seeded off/everyone (read: %)', coalesce(_mode, '<none>') USING ERRCODE = 'raise_exception';
  END IF;
  IF _stored IS DISTINCT FROM (CASE _mode WHEN 'everyone' THEN 'on' ELSE 'off' END) THEN
    RAISE EXCEPTION 'S5-0601-POST-002: site_settings (%) does not match the switch (%)', coalesce(_stored, '<none>'), _mode USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('authenticated', 'public.tg_photo_resume_to_site_setting()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tg_photo_resume_to_site_setting()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S5-0601-POST-003: the trigger function is reachable by an API role' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S5-0601 (lane %): photo_upload_resume is a feature switch, mode=%, site_settings=%',
    current_setting('p32.lane'), _mode, _stored;
END
$postconditions$;

COMMIT;
