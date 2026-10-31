-- ═══════════════════════════════════════════════════════════════════════════
-- P32 MAIL GROUP, 2 OF 3 NEW UNITS — SUPERSEDES
-- 20260522051954_a99922d3-9224-4b7f-ab27-c1b2b7f3f55a.sql, WHICH IS LEFT
-- UNTOUCHED IN PLACE.
--
-- That file already contains the correct revoke:
--
--     REVOKE EXECUTE ON FUNCTION public.emit_notification(...) FROM PUBLIC;
--     REVOKE EXECUTE ON FUNCTION public.emit_notification(...) FROM anon;
--     REVOKE EXECUTE ON FUNCTION public.emit_notification(...) FROM authenticated;
--
-- — correct because, unlike delete_email's file, it names anon and
-- authenticated explicitly rather than relying on a FROM-PUBLIC-only revoke,
-- so it does not fall into the F-62 trap. It is NOT modified here: this
-- project's convention (established by 20260910_0011/0012 vs. their
-- predecessor 20260910_0008, and by 20260910_0019/0020 vs. earlier
-- birthday-handle migrations) is that an existing migration is never edited
-- in place — a later migration supersedes it. This file is that later
-- migration, for two reasons a bare re-dispatch of the 2026-05-22 file would
-- not fix:
--
--   1. No rollback exists for the 2026-05-22 file anywhere in
--      supabase/rollback/ (confirmed by `git grep -l emit_notification` over
--      that directory this session — zero hits). This project's rule is that
--      every forward migration ships with a matching rollback in the same
--      unit. This file's own rollback (paired, same ordinal) closes that gap
--      without needing to touch the original.
--   2. No PROBE exists for it either. Closed by
--      PROBE_p32_mail_group_closed.sql, alongside this unit's other four
--      functions.
--
-- The 2026-05-22 file's three REVOKE statements are harmless to leave in
-- place — re-running this migration's own REVOKE ALL below is idempotent
-- regardless of whether the older file was ever dispatched, and does not
-- depend on it having run.
--
-- ───────────────────────────────────────────────────────────────────────────
-- CURRENT STATE, MEASURED — NOT ASSUMED
--
-- Live on staging (fpszggreishhuvdpkmdr), 2026-09-17, this session, before
-- this migration: proacl =
-- `{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
--   service_role=X/postgres}` — PUBLIC, anon and authenticated each hold their
-- own named EXECUTE entry. Same 2026-09-11 full-schema-bootstrap mechanism
-- documented for the rest of P32 (zero GRANT/REVOKE anywhere in that file)
-- reopened this function's grants regardless of whether the 2026-05-22
-- revoke had ever been dispatched to the project that predates the bootstrap.
--
-- The function body is untouched by this migration. Confirmed via
-- pg_get_functiondef immediately before authoring this file that the live
-- body is the real, complete implementation (idempotency check against
-- notification_emit_log, recipient lookup, in-app notification insert,
-- conditional enqueue_email call, forensic log insert) — not a stub, and not
-- something this migration has any reason to touch. This migration changes
-- privileges only.
--
-- ───────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS — MEASURED, NOT ASSUMED
--
-- Every caller of emit_notification, and the identity/ownership it runs
-- under, this session:
--
--   supabase/functions/publish-round/index.ts:259   admin.rpc(...), where
--     `admin` is constructed at line 42 with SUPABASE_SERVICE_ROLE_KEY (the
--     file also holds a separate anon-key `userClient` — the call in
--     question uses `admin`, not that client)
--   public.notify_entry_status_change()        SECURITY DEFINER, owner postgres
--   public.notify_round_published()             SECURITY DEFINER, owner postgres
--   public.notify_round_published_insert()      SECURITY DEFINER, owner postgres
--   public.backfill_judging_notifications(...)  SECURITY DEFINER, owner postgres
--   public.trg_entry_status_lifecycle_emit()     SECURITY DEFINER, owner postgres
--
-- All five database callers confirmed live, this session, via pg_proc joined
-- to pg_roles: `prosecdef = true`, `owner = postgres` for every one. A
-- SECURITY DEFINER function owned by `postgres` executes as its owner, and
-- object-owner/superuser calls bypass ACL EXECUTE checks entirely — the same
-- reasoning every REVOKE in this project's P30-P33 work has relied on for its
-- internal callers, checked here specifically rather than assumed. None of
-- these five is affected by revoking anon/authenticated/PUBLIC from
-- emit_notification.
--
-- `src/` has zero references beyond the generated `types.ts` type stub.
--
-- Legitimate callers losing access: ZERO.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.emit_notification(
  text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.emit_notification(
  text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text
) TO service_role;

COMMENT ON FUNCTION public.emit_notification(
  text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text
) IS
  'P32 mail group. SECURITY DEFINER notification dispatcher: writes user_notifications, conditionally enqueues transactional email, and logs to notification_emit_log. Privileged-only: callers are service_role edge functions (publish-round) and postgres-owned SECURITY DEFINER triggers/functions, never a member session directly. Supersedes the correct-but-unpaired revoke in 20260522051954_a99922d3-9224-4b7f-ab27-c1b2b7f3f55a.sql (left in place, untouched) by adding the rollback and PROBE that file never had.';

COMMIT;
