-- ROLLBACK · 20261110_0115 photo blur. Drops the three functions and the code
-- table. Safe at any time: the card falls back to its 600-copy blur when the
-- read is gone (photoBlur.ts treats a refused / missing call as "no code").
-- The codes are re-made by photo-blur.yml if 0115 is applied again.
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.post_photo_blurs(uuid[]);
DROP FUNCTION IF EXISTS public.photo_blur_todo(integer);
DROP FUNCTION IF EXISTS public.photo_blur_record(jsonb);
DROP FUNCTION IF EXISTS public.photo_blur_pending();
DROP FUNCTION IF EXISTS public.photo_blur_wanted();
DROP TABLE IF EXISTS public.photo_blur;

DO $post$
BEGIN
  IF to_regclass('public.photo_blur') IS NOT NULL THEN RAISE EXCEPTION 'BL-0115-RB: photo_blur still exists'; END IF;
  RAISE NOTICE 'BL-0115 rolled back on %', current_setting('p32.lane');
END
$post$;

COMMIT;
