-- ═══════════════════════════════════════════════════════════════════════════
-- P32 MAIL GROUP, 3 OF 3 NEW UNITS — move_to_dlq(text,text,bigint,jsonb) ONLY.
-- DELIBERATELY SCOPED NARROWER THAN THE EXISTING BUNDLED MIGRATION.
--
-- `20260814080227_queue_and_writer_authority.sql` already closes move_to_dlq
-- correctly (queue-pair allow-list added to the body, grants revoked and
-- reopened by the 2026-09-11 bootstrap exactly like the rest of this group)
-- — but that file ALSO revokes three functions that are not part of the mail
-- group under this task's scope:
--
--   public._ensure_stats_row(uuid)
--   public.log_push_outcome(uuid, uuid, text, text, text)
--   public.wallet_ledger_v2_diff_snapshot(interval)
--
-- Per `claude/2026-09-15-p32-census-and-root-cause.md` §4, those three sit in
-- the "zero references anywhere in src/ or edge functions" P32 subgroup, not
-- the mail group. This unit's task is explicitly scoped to the five named
-- mail/email functions and explicitly forbidden from deciding those three are
-- in scope here. `20260814080227_queue_and_writer_authority.sql` and its
-- rollback are NOT modified or superseded by this file — they remain
-- available, unchanged, as the eventual closure for that other subgroup, on
-- its own turn.
--
-- This migration exists so the mail group's dispatch does not have to wait on
-- — or force — a scope decision about a different subgroup. It revokes
-- EXACTLY move_to_dlq(text,text,bigint,jsonb) and nothing else.
--
-- ───────────────────────────────────────────────────────────────────────────
-- CURRENT STATE, MEASURED — NOT ASSUMED
--
-- Live on staging (fpszggreishhuvdpkmdr), 2026-09-17, this session, before
-- this migration: proacl =
-- `{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
--   service_role=X/postgres}` — same open shape as the rest of the group,
-- same 2026-09-11 bootstrap mechanism (zero GRANT/REVOKE anywhere in that
-- file).
--
-- The function body is untouched by this migration. Confirmed via
-- pg_get_functiondef immediately before authoring this file that the live
-- body already carries the queue-pair allow-list from
-- `20260814080227_queue_and_writer_authority.sql`
-- (`source_queue NOT IN ('transactional_emails', 'auth_emails') OR dlq_name
-- NOT IN ('transactional_emails_dlq', 'auth_emails_dlq')` raises 42501) — the
-- body fix already survived the bootstrap the same way
-- enqueue_email/read_email_batch's did; only the grant was reset. This
-- migration changes privileges only, and does not repeat or duplicate the
-- body change already live.
--
-- ───────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS — MEASURED, NOT ASSUMED
--
-- Every caller of move_to_dlq, and the identity it calls with, this session:
--
--   supabase/functions/process-email-queue/index.ts:72   SERVICE_ROLE_KEY
--     (client constructed at line 116 with SUPABASE_SERVICE_ROLE_KEY)
--
-- `src/` has zero references beyond the generated `types.ts` type stub.
--
-- Legitimate callers losing access: ZERO.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

COMMENT ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) IS
  'P32 mail group. SECURITY DEFINER dead-letter mover: sends a message to a DLQ and deletes it from its source queue. Privileged-only: only process-email-queue (service_role) calls it. Grant closed 2026-09-17, scoped to this function alone — deliberately not bundled with the other three functions 20260814080227_queue_and_writer_authority.sql also revokes, which belong to a different P32 subgroup and are out of scope for this unit.';

COMMIT;
