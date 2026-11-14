-- ROLLBACK of 20261114_0901_competition_photos_own_folder.sql — restores the
-- policy measured by PROBE 0900 on 2026-11-14 (both lanes identical).
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
END
$lane_guard$;

DROP POLICY IF EXISTS "competition-photos: own folder or staff upload" ON storage.objects;

CREATE POLICY "Authenticated users can upload photos" ON storage.objects
  FOR INSERT TO public
  WITH CHECK ((bucket_id = 'competition-photos'::text) AND (auth.role() = 'authenticated'::text));

COMMIT;
