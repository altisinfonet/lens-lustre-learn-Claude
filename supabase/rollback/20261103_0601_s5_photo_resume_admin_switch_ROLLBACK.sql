-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261103_0601 Admin → Uploads → Upload Resume.
-- Removes exactly what 0601 created: the trigger, its function, the
-- photo_upload_resume feature row (its member list goes with it, ON DELETE
-- CASCADE) and the key in feature_access_feature_check.
-- KEPT: the audit rows (append-only, a record) and the site_settings row (the
-- switch every app build reads). Whatever it holds stays safe: "on" stays on,
-- "off" stays off, and "selected" reads OFF everywhere — old builds compare
-- === "on", new builds ask feature_allowed_me, which has no row → false.
-- Refuses when 0601 is not applied, so a second run fails loudly.
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
  IF to_regprocedure('public.tg_photo_resume_to_site_setting()') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'photo_upload_resume') THEN
    RAISE EXCEPTION 'S5-0601-RB-PRE-001: 20261103_0601 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

DROP TRIGGER IF EXISTS trg_photo_resume_to_site_setting ON public.feature_access;
DROP FUNCTION IF EXISTS public.tg_photo_resume_to_site_setting();
DELETE FROM public.feature_access WHERE feature = 'photo_upload_resume';

ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check;
ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
  CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed',
                     'media_ladder_feed', 'media_private_photos'));

DO $post$
BEGIN
  IF to_regprocedure('public.tg_photo_resume_to_site_setting()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'photo_upload_resume') THEN
    RAISE EXCEPTION 'S5-0601-RB-POST-001: 0601 objects still present';
  END IF;
  RAISE NOTICE 'S5-0601 rolled back (lane %); site_settings photo_upload_resume kept: %', current_setting('p32.lane'),
    coalesce((SELECT s.value::text FROM public.site_settings s WHERE s.key = 'photo_upload_resume'), '(no row = off)');
END
$post$;

COMMIT;
