-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260917140000_p32_media_pipeline_acl_reassertion.sql
--
-- ⚠ THIS RESTORES A KNOWN, CONFIRMED-LIVE SECURITY EXPOSURE. It exists
-- because every migration in this project ships a rollback, and because a
-- rollback that has never been written is a rollback that does not work. It
-- is not a recommendation. Restoring these grants makes all 8 media-pipeline
-- write-path functions callable again by any holder of the public anon key —
-- including media_quarantine (unauthenticated content takedown: no
-- ownership check in its body, confirmed by direct read of
-- 20260814234206_media_takedown_consistency.sql) and media_migrate_post (no
-- auth.uid() reference anywhere in its body — arbitrary caller-supplied
-- owner_id/post_id trusted outright).
--
-- If this file is ever run, the only acceptable next step is re-applying the
-- forward migration in the same session.
--
-- No function body is touched by this rollback — the forward migration never
-- touched a body either, so there is nothing to restore beyond the grants.
-- This is the EXACT live ACL this project's forensic report
-- (claude/2026-09-17-P32-media-pipeline-FORENSICS.md, §B) measured on
-- fpszggreishhuvdpkmdr via has_function_privilege() before this migration
-- closed anything: PUBLIC, anon, authenticated and service_role all TRUE,
-- on all 8 functions, with no exceptions. Not guessed — read live.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text)
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.media_mark_ready(uuid, jsonb)
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.media_mark_verified(uuid)
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.media_migrate_post(uuid, uuid, jsonb)
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.media_quarantine(uuid, text)
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.post_attach_media(uuid, uuid[])
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[])
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid)
  TO PUBLIC, anon, authenticated, service_role;

COMMIT;
