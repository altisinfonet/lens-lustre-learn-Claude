-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0027_p32identity2_admin_search_and_generate_url_revoke.sql
--
-- ⚠ THIS RESTORES A KNOWN EXPOSURE. It exists because the project rule is that
-- every migration has a matching rollback, and a rollback that has never been
-- written is a rollback that does not work. It is not a recommendation.
--
-- Restores anon/PUBLIC EXECUTE on the four admin search RPCs (each still
-- internally gated by has_role(auth.uid(),'admin'), so this reopens the
-- attack surface the grant itself controls, not a bypass of the internal
-- check) and anon/PUBLIC/authenticated on generate_custom_url.
--
-- ⚠ NOT a guess. Restores the EXACT predecessor ACL, measured directly via
-- has_function_privilege on staging (fpszggreishhuvdpkmdr) on 2026-09-17,
-- immediately before the forward migration in this pair ran: all five
-- proacl = {=X/postgres, postgres=X/postgres, anon=X/postgres,
-- authenticated=X/postgres, service_role=X/postgres} — PUBLIC, anon,
-- authenticated and service_role each held their own explicit EXECUTE grant.
--
-- No function body is touched by the forward migration and none is touched
-- here — grants only.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users_v2(text, text, text, text, integer, integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_certificates(text, text, integer, integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_certificate_recipients(text, integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_custom_url(text, uuid) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
