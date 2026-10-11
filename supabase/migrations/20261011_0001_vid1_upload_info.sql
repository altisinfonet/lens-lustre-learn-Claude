-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261011_0001 — video_upload_info(): the owner's own uploading
-- version, for /api/video/upload-urls and /api/video/complete.
-- Lanes: staging and production. Needs 20261005_0005 (videos, video_versions).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SYMPTOM (Owner, staging, 2026-10-11): "Your video couldn't be posted —
-- permission denied for table video_versions". Two uploads stuck in
-- 'uploading', 0 objects in the bucket.
--
-- CAUSE: functions/api/video/_lib.ts loadUploadingVersion() read
--   video_versions?select=manifest_sha256,total_bytes,…
-- as the member. 0005 grants `authenticated` SELECT on only ten columns of
-- video_versions (version_no, width, height, declared_duration_s, has_audio,
-- renditions, remedy, library_track_id, created_at, video_id) — manifest_sha256
-- and total_bytes are deliberately NOT readable by API roles. So the read is
-- refused before RLS is even consulted. (The unit tests mocked this read.)
--
-- FIX: keep the column grants exactly as designed and add one narrow,
-- owner-only function that returns those values for THE CALLER'S OWN video,
-- ONLY for its current version, never for a deleted one. The endpoints keep
-- judging the state themselves (409 "not uploading any more"; `complete`'s
-- idempotent replay after success, which the OFF-2 outbox relies on), so the
-- function does not filter on state. Anyone else — another member, anon —
-- gets zero rows, so the answer never says whether a video exists (same as
-- the endpoints' 404).
--
-- SECURITY DEFINER because the caller cannot read those columns; the WHERE
-- clause is the control: owner_id = (select auth.uid()) AND deleted_at IS NULL
-- AND the version is current. search_path = ''.
-- EXECUTE: authenticated only (PUBLIC and anon revoked).
--
-- ROLLBACK: supabase/rollback/20261011_0001_vid1_upload_info_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_vid1_upload_info.sql
-- OBJECTS (reservation): new public.video_upload_info(uuid, integer). Nothing
-- else is created, altered or granted.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.videos') IS NULL OR to_regclass('public.video_versions') IS NULL THEN
    RAISE EXCEPTION 'VID-UI-PRE-001: 20261005_0005 (videos, video_versions) is not applied';
  END IF;
  IF to_regprocedure('public.video_upload_info(uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID-UI-PRE-002: public.video_upload_info(uuid,integer) already exists';
  END IF;
END
$pre$;

CREATE FUNCTION public.video_upload_info(_video_id uuid, _version_no integer)
RETURNS TABLE (manifest_sha256 text, total_bytes bigint, declared_duration_s numeric, has_audio boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT vv.manifest_sha256, vv.total_bytes, vv.declared_duration_s, vv.has_audio
    FROM public.videos v
    JOIN public.video_versions vv
      ON vv.video_id = v.id
     AND vv.version_no = v.current_version
   WHERE v.id = _video_id
     AND vv.version_no = _version_no
     AND v.owner_id = (SELECT auth.uid())
     AND v.deleted_at IS NULL;
$fn$;

REVOKE ALL ON FUNCTION public.video_upload_info(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.video_upload_info(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.video_upload_info(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.video_upload_info(uuid, integer) IS
  'VID-1: manifest_sha256/total_bytes/declared_duration_s/has_audio of the CALLER''S OWN, not-deleted video, current version only (zero rows otherwise). Used by /api/video/upload-urls and /complete. Migration 20261011_0001.';

DO $post$
BEGIN
  RAISE NOTICE 'VID-UI-0001: video_upload_info(uuid,integer) installed — owner-only, current version, authenticated EXECUTE';
END
$post$;

COMMIT;
