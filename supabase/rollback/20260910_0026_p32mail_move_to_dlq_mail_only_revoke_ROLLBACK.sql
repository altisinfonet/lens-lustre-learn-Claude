-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0026_p32mail_move_to_dlq_mail_only_revoke.sql
--
-- ⚠ THIS RESTORES A KNOWN EXPOSURE. It exists because the project rule is that
-- every migration has a matching rollback, and a rollback that has never been
-- written is a rollback that does not work. It is not a recommendation.
--
-- Restoring this grant makes `/rest/v1/rpc/move_to_dlq` callable with the
-- public anon key again: `pgmq.delete()` against any allow-listed source
-- queue by message id, including q_auth_emails.
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
-- Scoped to move_to_dlq alone, matching the forward migration this rolls
-- back — this file does NOT touch _ensure_stats_row, log_push_outcome or
-- wallet_ledger_v2_diff_snapshot, which this unit never revoked in the first
-- place.
--
-- The function body is untouched by the forward migration (it already
-- carried the queue-pair allow-list before this pair ran, from
-- 20260814080227_queue_and_writer_authority.sql) and is therefore untouched
-- here too — no CREATE OR REPLACE in this file, grants only.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
