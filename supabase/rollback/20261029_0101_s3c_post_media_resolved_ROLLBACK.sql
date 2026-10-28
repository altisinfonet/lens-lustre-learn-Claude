-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261029_0101 — S3-c resolved post media + switch media_ladder_feed.
-- Faster first step: set the switch to Off in Admin → Features (instant; the
-- client goes back to post_media_for). This file removes the objects: the RPC,
-- media_cdn_origin(), the switch row and its member list (the audit rows stay —
-- append-only), and puts the constraint back to the 20261018_0003 list.
-- Refuses while 0102 (media_private_photos) is applied: roll that back first.
-- The client tolerates the RPC being absent (it falls back to post_media_for).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb_preconditions$
BEGIN
  IF to_regprocedure('public.post_media_resolved_for(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'S3C-0101-RB-001: 20261029_0101 is not applied' USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'media_private_photos') THEN
    RAISE EXCEPTION 'S3C-0101-RB-002: roll back 20261029_0102 first (media_private_photos exists)' USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_preconditions$;

DROP FUNCTION public.post_media_resolved_for(uuid[]);
DROP FUNCTION public.media_cdn_origin();

INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, feature, 'mode', mode, NULL, '20261029_0101 rollback: switch removed'
  FROM public.feature_access WHERE feature = 'media_ladder_feed';
DELETE FROM public.feature_access WHERE feature = 'media_ladder_feed';   -- members cascade

ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check;
ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
  CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed'));

COMMIT;
