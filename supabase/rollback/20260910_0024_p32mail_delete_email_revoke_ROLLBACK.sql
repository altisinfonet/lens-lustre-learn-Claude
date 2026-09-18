-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0024_p32mail_delete_email_revoke.sql
--
-- ⚠ THIS RESTORES A KNOWN EXPOSURE. It exists because the project rule is that
-- every migration has a matching rollback, and a rollback that has never been
-- written is a rollback that does not work. It is not a recommendation.
--
-- Restoring these grants makes `/rest/v1/rpc/delete_email` callable with the
-- public anon key, permitting deletion of any message on any named pgmq
-- queue by id, including q_auth_emails (pending authentication mail).
--
-- If this file is ever run, the only acceptable next step is a corrected
-- forward migration in the same session.
--
-- ⚠ NOT a guess. This restores the EXACT predecessor ACL, measured directly
-- via aclexplode(proacl)/has_function_privilege on staging (fpszggreishhuvdpkmdr)
-- on 2026-09-17, immediately before the forward migration in this pair ran:
--
--   proacl = {=X/postgres, postgres=X/postgres, anon=X/postgres,
--             authenticated=X/postgres, service_role=X/postgres}
--
-- i.e. PUBLIC (the bare `=` entry, from ALTER DEFAULT PRIVILEGES), anon,
-- authenticated and service_role each held their own explicit EXECUTE grant.
-- That is what this file restores — not merely "the state before 0011/0012",
-- and not the narrower FROM-PUBLIC-only grant `20260322151646_email_infra.sql`
-- originally wrote, since that file's own revoke never actually removed the
-- anon/authenticated entries this rollback is restoring (see the forward
-- migration's header). This is the true, fully-open predecessor state.
--
-- The function body is untouched by the forward migration and is therefore
-- untouched here too — no CREATE OR REPLACE in this file, grants only.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
