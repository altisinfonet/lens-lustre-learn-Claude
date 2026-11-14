-- ═══════════════════════════════════════════════════════════════════════════
-- 20261114_0901 · competition-photos: a member uploads only into their own folder
--
-- Measured by PROBE 0900 (both lanes): the only INSERT policy on this bucket,
-- "Authenticated users can upload photos", lets ANY signed-in member write ANY
-- path — including into another member's folder or the staff folders.
--
-- The app writes:
--   members  <own uid>/competitions/…   (CompetitionSubmit, EditEntryDialog via
--                                         imageUpload / photoSetUpload)
--   staff    cover / judging-tag images (Admin → Competitions, Judging tags;
--            tabs open to admin, judge, content_editor — src/lib/adminRoleAccess.ts)
-- New rule = exactly that: own first folder, or staff anywhere in the bucket.
-- Uploads go to R2 while external storage is on; this policy guards the
-- Supabase fallback and the direct storage API.
--
-- Rollback: supabase/rollback/20261114_0901_competition_photos_own_folder_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261114_0901_sec_audit_rest.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
END
$lane_guard$;

DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;

CREATE POLICY "competition-photos: own folder or staff upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'competition-photos'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR public.has_role((SELECT auth.uid()), 'admin'::text)
      OR public.has_role((SELECT auth.uid()), 'judge'::text)
      OR public.has_role((SELECT auth.uid()), 'content_editor'::text)
    )
  );

COMMIT;
