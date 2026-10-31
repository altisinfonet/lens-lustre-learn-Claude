-- ROLLBACK for 20261011_0001_vid1_upload_info.sql
-- Removes the owner-only function. Uploads then fail again at upload-urls /
-- complete ("permission denied for table video_versions") until the client
-- stops calling it — roll back the client (functions/api/video/_lib.ts) first.
BEGIN;
DROP FUNCTION IF EXISTS public.video_upload_info(uuid, integer);
DO $post$ BEGIN RAISE NOTICE 'VID-UI-0001 ROLLBACK: video_upload_info removed'; END $post$;
COMMIT;
