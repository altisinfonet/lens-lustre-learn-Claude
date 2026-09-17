-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0025_p32mail_emit_notification_revoke.sql
--
-- ⚠ THIS RESTORES A KNOWN EXPOSURE. It exists because the project rule is that
-- every migration has a matching rollback, and a rollback that has never been
-- written is a rollback that does not work. It is not a recommendation.
--
-- Restoring these grants makes `/rest/v1/rpc/emit_notification` callable with
-- the public anon key: an unauthenticated caller could insert arbitrary
-- user_notifications rows for any recipient, enqueue arbitrary transactional
-- email, and write forensic-log rows under their own control.
--
-- If this file is ever run, the only acceptable next step is a corrected
-- forward migration in the same session.
--
-- ⚠ NOT a guess. Restores the EXACT predecessor ACL, measured directly via
-- aclexplode(proacl)/has_function_privilege on staging (fpszggreishhuvdpkmdr)
-- on 2026-09-17, immediately before the forward migration in this pair ran:
--
--   proacl = {=X/postgres, postgres=X/postgres, anon=X/postgres,
--             authenticated=X/postgres, service_role=X/postgres}
--
-- PUBLIC, anon, authenticated and service_role each held their own explicit
-- EXECUTE grant. That is what this file restores.
--
-- Verified this rollback does not break any database-owned SECURITY DEFINER
-- caller: re-granting anon/authenticated/PUBLIC only ADDS privilege, it never
-- removes service_role's own grant or the object-owner bypass that
-- notify_entry_status_change / notify_round_published /
-- notify_round_published_insert / backfill_judging_notifications /
-- trg_entry_status_lifecycle_emit rely on (all five postgres-owned SECURITY
-- DEFINER, confirmed live) — a rollback that only widens a grant cannot break
-- a caller that already worked under the narrower one.
--
-- The function body is untouched by the forward migration and is therefore
-- untouched here too — no CREATE OR REPLACE in this file, grants only.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.emit_notification(
  text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text
) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
