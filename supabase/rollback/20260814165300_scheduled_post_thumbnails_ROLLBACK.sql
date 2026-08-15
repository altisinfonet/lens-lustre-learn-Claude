-- ROLLBACK for 20260814165300_scheduled_post_thumbnails.sql
--
-- Drops the column. Guarded: if any pending scheduled post is actually
-- CARRYING thumbnails, dropping the column silently discards a member's data
-- and their post publishes without thumbnails — the exact defect the forward
-- migration exists to fix. Resolve those rows deliberately, then re-run.

BEGIN;

DO $$
DECLARE _n bigint;
BEGIN
  IF to_regclass('public.scheduled_posts') IS NULL THEN
    RAISE NOTICE 'scheduled_posts does not exist; nothing to roll back';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_posts'
      AND column_name = 'thumbnail_urls'
  ) THEN
    EXECUTE $q$
      SELECT count(*) FROM public.scheduled_posts
       WHERE coalesce(array_length(thumbnail_urls, 1), 0) > 0
    $q$ INTO _n;
    IF _n > 0 THEN
      RAISE EXCEPTION 'ROLLBACK ABORTED: % scheduled post(s) carry thumbnails. '
        'Dropping the column discards them and their posts publish without '
        'thumbnails. Resolve deliberately, then re-run.', _n;
    END IF;
  END IF;
END $$;

ALTER TABLE public.scheduled_posts DROP COLUMN IF EXISTS thumbnail_urls;

COMMIT;
