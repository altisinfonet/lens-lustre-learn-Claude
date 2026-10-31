-- ═══════════════════════════════════════════════════════════════════════════
-- P32 IDENTITY GROUP, PART 2 — the 5 functions left open after the
-- claim_username/change_custom_url/clear_custom_url dispatch (0011/0012,
-- verified this session, see claude/2026-09-17-P32-identity-group-
-- DISPATCHED-and-verified.md). Closes:
--
--   admin_search_users(text, text)
--   admin_search_users_v2(text, text, text, text, integer, integer)
--   admin_list_certificates(text, text, integer, integer)
--   admin_search_certificate_recipients(text, integer)
--   generate_custom_url(text, uuid)
--
-- Measured live on staging (fpszggreishhuvdpkmdr), 2026-09-17, this session,
-- before this migration: all five proacl = `{=X/postgres, postgres=X/postgres,
-- anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}` — wide
-- open, same 2026-09-11 full-schema-bootstrap mechanism as every other P32
-- group (zero GRANT/REVOKE anywhere in that file).
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠ WHY THIS IS A NEW FILE AND NOT A DISPATCH OF THE TWO FILES THAT ALREADY
-- CONTAIN THESE EXACT REVOKES
--
-- `supabase/migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql`
-- already contains, verified by reading it directly: the admin_search_users_v2
-- CREATE, its own `has_role(auth.uid(),'admin')` gate, and
-- `REVOKE ALL ON FUNCTION public.admin_search_users_v2 ... FROM PUBLIC` /
-- `FROM anon` / `GRANT ... TO authenticated` — exactly the shape this file
-- also writes. `UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql`
-- does the same for admin_list_certificates and
-- admin_search_certificate_recipients. `20260910_0007_f93_custom_url_
-- generator.sql` already contains `REVOKE ALL ON FUNCTION
-- public.generate_custom_url(text, uuid) FROM public, anon, authenticated;`
-- (confirmed live-reopened by the bootstrap regardless — see below).
--
-- Those two `UNAPPLIED_` files are not dispatched by this migration, and are
-- not renamed into the dispatchable sequence by it, because each bundles real
-- application behaviour beyond the P32 ACL question this task is scoped to:
-- a new `idx_profiles_created_at_id_desc` / `idx_certificates_issued_at_id_desc`
-- index, and — in the certificates file — a `certificates_type_check`
-- constraint restatement. Dispatching either file would apply that bundled
-- behaviour change too, unreviewed against this task's narrow P32 scope, and
-- outside what "no unrelated cleanup" / "no speculative code changes" permits
-- this unit to decide unilaterally. `src/__tests__/adminUserListPagination.
-- test.ts` and `src/__tests__/adminCertificates.test.ts` already pin those
-- two files' *content* as source tests — that is unaffected by this file,
-- which touches neither of them.
--
-- `20260910_0007_f93_custom_url_generator.sql` is different in kind: it is
-- not `UNAPPLIED_`, and its REVOKE already ran once (this is F-93 original
-- work, well before the 2026-09-11 bootstrap). The bootstrap reopened it the
-- same way it reopened 0011's predecessor 0008 (F-66) — confirmed by the live
-- ACL read above showing anon/authenticated/PUBLIC all still holding EXECUTE
-- today. Re-running an identical REVOKE is idempotent and does not modify
-- 0007's file.
--
-- This migration therefore does the one thing squarely in scope: re-assert
-- the ACL, in the reserved Phase-1 migration block, dispatchable and
-- PROBE-gated, without adopting index/constraint changes this task was never
-- asked to review.
--
-- ───────────────────────────────────────────────────────────────────────────
-- BODY DIFFERENCE FROM THE RETAINED-authenticated PATTERN USED ELSEWHERE
--
-- The four admin_* functions keep `authenticated` EXECUTE — each has its own
-- `IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION` gate
-- (confirmed via pg_get_functiondef, this session), so a non-admin
-- authenticated caller is refused by the function body itself; the grant
-- only needs to admit real admins, who authenticate normally first. This is
-- the same shape as PR #256's money/account-control batch.
--
-- generate_custom_url is different: it carries no role check at all, and has
-- ZERO callers anywhere in src/, supabase/functions/ or functions/ (grepped
-- this session). Its only caller in the whole repository is
-- tg_profiles_assign_custom_url, confirmed via pg_proc this session:
-- SECURITY DEFINER, owner postgres — it executes as its owner and bypasses
-- EXECUTE-privilege checks entirely as the object owner/superuser, the same
-- reasoning already relied on throughout P32 for internal definer callers.
-- So revoking `authenticated` here (matching 0007's own original intent, and
-- matching clear_custom_url's identical zero-caller closure in 0012) breaks
-- nothing live.
--
-- ───────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS — MEASURED, NOT ASSUMED
--
-- admin_search_users    — src/components/AdminGiftCredit.tsx:59 (authenticated
--                          admin UI; AdminUsers.tsx moved to v2 on 2026-08-24
--                          per its own header comment, but this one caller
--                          still uses v1 directly)
-- admin_search_users_v2 — src/components/admin/AdminUsers.tsx:277 (authenticated
--                          admin UI)
-- admin_list_certificates              — src/components/admin/AdminCertificates.tsx:148
-- admin_search_certificate_recipients  — src/components/admin/AdminCertificates.tsx:260
-- generate_custom_url   — zero src/edge callers; one internal SECURITY
--                          DEFINER/postgres-owned trigger caller (unaffected,
--                          see above)
--
-- Legitimate callers losing access: ZERO.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.admin_search_users(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_search_users_v2(text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users_v2(text, text, text, text, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_list_certificates(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_certificates(text, text, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_search_certificate_recipients(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_certificate_recipients(text, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.generate_custom_url(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_custom_url(text, uuid) TO service_role;

COMMENT ON FUNCTION public.admin_search_users(text, text) IS
  'P32 identity group, part 2. Internally gated on has_role(auth.uid(),''admin''). Admin-only caller: AdminGiftCredit.tsx. Grant closed 2026-09-17.';
COMMENT ON FUNCTION public.admin_search_users_v2(text, text, text, text, integer, integer) IS
  'P32 identity group, part 2. Internally gated on has_role(auth.uid(),''admin''). Admin-only caller: AdminUsers.tsx. Grant closed 2026-09-17.';
COMMENT ON FUNCTION public.admin_list_certificates(text, text, integer, integer) IS
  'P32 identity group, part 2. Internally gated on has_role(auth.uid(),''admin''). Admin-only caller: AdminCertificates.tsx. Grant closed 2026-09-17.';
COMMENT ON FUNCTION public.admin_search_certificate_recipients(text, integer) IS
  'P32 identity group, part 2. Internally gated on has_role(auth.uid(),''admin''). Admin-only caller: AdminCertificates.tsx. Grant closed 2026-09-17.';
COMMENT ON FUNCTION public.generate_custom_url(text, uuid) IS
  'P32 identity group, part 2. SECURITY DEFINER custom-URL generator (F-93). Zero application callers; only caller is tg_profiles_assign_custom_url, SECURITY DEFINER owned by postgres, unaffected by this revoke. Re-asserts the REVOKE already written in 20260910_0007_f93_custom_url_generator.sql, reopened by the 2026-09-11 full-schema bootstrap (F-66). Grant closed 2026-09-17.';

COMMIT;
