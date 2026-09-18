-- ═══════════════════════════════════════════════════════════════════════════
-- P32 MEDIA PIPELINE — ACL REASSERTION (grants only, no body changes)
--
-- Closes the gap recorded in the project's P32 media-pipeline forensic
-- report (2026-09-17): all 8 functions below already carry an explicit
-- `REVOKE ... FROM anon` (5 of the 8 also `FROM authenticated`) in the
-- migration that defines their current body, but the LIVE database
-- (fpszggreishhuvdpkmdr) shows every one of them anon-executable today, and
-- 5 of them additionally authenticated-executable where the design intends
-- service_role only.
--
-- ROOT CAUSE, measured, not assumed: `mcp__Supabase__list_migrations`
-- against this project returns only 8 applied entries (all dated
-- 2026-09-15, none of them these 8 functions' migrations). The live body of
-- e.g. `media_mark_ready` is byte-for-byte identical to
-- `20260820090000_candidate_pattern_widened.sql` (confirmed via
-- `pg_get_functiondef`), so the bodies reached this database by some route
-- — but `supabase/migrations/UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql`
-- (created the same day as this project, "extracted read-only ... via
-- catalog introspection") contains ZERO `GRANT`/`REVOKE` statements anywhere
-- in its 19,101 lines. This is the same failure this project has already
-- named and tested for elsewhere (F-66 / F-62): `ALTER DEFAULT PRIVILEGES`
-- grants EXECUTE on every function in `public` to anon and authenticated at
-- creation time, and a function that is recreated without its own
-- accompanying REVOKE silently reopens.
--
-- THIS FILE DOES NOT CHANGE ANY FUNCTION BODY, SIGNATURE, RETURN TYPE,
-- OWNER, VOLATILITY, OR SECURITY DEFINER STATUS. Grants only, matching the
-- SAME target ACL each function's own defining migration already states —
-- this is a re-assertion of existing, already-reviewed intent, not a new
-- design decision. Full caller inventory and per-function risk analysis:
-- the project doc `claude/2026-09-17-P32-media-pipeline-FORENSICS.md`.
--
-- TARGET ACL (PUBLIC and anon always closed; authenticated and service_role
-- per function, matching each function's own defining migration):
--
--   media_begin_upload(bytea,integer,integer,bigint,text)                    authenticated KEEP  service_role KEEP
--   media_mark_ready(uuid,jsonb)                                             authenticated CLOSE service_role KEEP
--   media_mark_verified(uuid)                                                authenticated CLOSE service_role KEEP
--   media_migrate_post(uuid,uuid,jsonb)                                      authenticated CLOSE service_role KEEP
--   media_quarantine(uuid,text)                                              authenticated CLOSE service_role KEEP
--   post_attach_media(uuid,uuid[])                                           authenticated CLOSE service_role KEEP
--   post_publish_with_media(uuid[],text,text,text[],boolean,text,text[])     authenticated KEEP  service_role KEEP
--   publish_post_draft(uuid)                                                 authenticated KEEP  service_role KEEP
--
-- Legitimate callers verified, zero breakage on close (forensic report §C):
--   authenticated KEEP: real browser callers via the member session
--     (src/lib/media/postMediaWrite.ts, src/hooks/feed/usePostDrafts.ts).
--   authenticated CLOSE: every real caller is a service_role edge function
--     (media-register-upload, media-verify-upload, backfill-media-objects,
--     migrate-post-media, publish-scheduled-posts) or, for post_attach_media,
--     an internal `PERFORM` from publish_post_draft — a SECURITY DEFINER
--     call that executes as the function owner (postgres) and is therefore
--     unaffected by a REVOKE on the anon/authenticated roles.
--
-- Each REVOKE is stated against PUBLIC, anon and authenticated individually
-- and by name (not `FROM PUBLIC, anon` combined) per F-62: `FROM PUBLIC`
-- alone does not remove a grant already held by a NAMED role, so anon and
-- authenticated must each be named explicitly to actually close them.
-- REVOKE is idempotent (no error, at most a NOTICE, when the named role
-- holds no such privilege), so this file is safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. media_begin_upload — authenticated KEEP (real browser caller) ──────
REVOKE ALL PRIVILEGES ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.media_begin_upload(bytea, integer, integer, bigint, text) TO service_role;

-- ── 2. media_mark_ready — service_role only ────────────────────────────────
REVOKE ALL PRIVILEGES ON FUNCTION public.media_mark_ready(uuid, jsonb) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_mark_ready(uuid, jsonb) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_mark_ready(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_mark_ready(uuid, jsonb) TO service_role;

-- ── 3. media_mark_verified — service_role only ─────────────────────────────
REVOKE ALL PRIVILEGES ON FUNCTION public.media_mark_verified(uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_mark_verified(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_mark_verified(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_mark_verified(uuid) TO service_role;

-- ── 4. media_migrate_post — service_role only ──────────────────────────────
REVOKE ALL PRIVILEGES ON FUNCTION public.media_migrate_post(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_migrate_post(uuid, uuid, jsonb) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_migrate_post(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_migrate_post(uuid, uuid, jsonb) TO service_role;

-- ── 5. media_quarantine — service_role only ────────────────────────────────
REVOKE ALL PRIVILEGES ON FUNCTION public.media_quarantine(uuid, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_quarantine(uuid, text) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.media_quarantine(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_quarantine(uuid, text) TO service_role;

-- ── 6. post_attach_media — service_role only (internal caller is the ──────
--      function owner via SECURITY DEFINER PERFORM, unaffected by this) ────
REVOKE ALL PRIVILEGES ON FUNCTION public.post_attach_media(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.post_attach_media(uuid, uuid[]) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.post_attach_media(uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.post_attach_media(uuid, uuid[]) TO service_role;

-- ── 7. post_publish_with_media — authenticated KEEP (real browser caller) ──
REVOKE ALL PRIVILEGES ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_publish_with_media(uuid[], text, text, text[], boolean, text, text[]) TO service_role;

-- ── 8. publish_post_draft — authenticated KEEP (real browser caller) ──────
REVOKE ALL PRIVILEGES ON FUNCTION public.publish_post_draft(uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.publish_post_draft(uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.publish_post_draft(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_post_draft(uuid) TO service_role;

COMMIT;
