-- ═══════════════════════════════════════════════════════════════════════════
-- P32 MAIL GROUP, 1 OF 3 NEW UNITS — delete_email(text, bigint) WAS NEVER
-- CORRECTLY CLOSED. THE EXISTING REVOKE IS THE EXACT F-62 NO-OP THIS PROJECT
-- HAS ALREADY FOUND AND FIXED TWICE.
--
-- `20260322151646_email_infra.sql:201-202` already wrote:
--
--     REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
--     GRANT  EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;
--
-- `FROM PUBLIC` alone does not remove a grant held by a NAMED role (F-62).
-- Measured on staging (fpszggreishhuvdpkmdr) 2026-09-17, this session,
-- read-only, before this migration: `delete_email`'s live proacl is
-- `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres}` — anon and authenticated each hold their OWN
-- named ACL entry, not merely inherited through the bare PUBLIC entry, from
-- `ALTER DEFAULT PRIVILEGES` (F-65/F-66). A `FROM PUBLIC`-only revoke, even
-- freshly re-run, would leave both of those named entries untouched. This is
-- not theoretical: it is what today's live catalogue read shows, on the exact
-- function this file targets. `enqueue_email` and `read_email_batch` already
-- had this fixed correctly in `20260814042609_email_queue_authority.sql`,
-- which is why this migration follows that file's exact shape rather than
-- inventing a new one.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT delete_email DOES, AND WHY THE OPEN GRANT MATTERS
--
--   delete_email(queue_name text, message_id bigint) RETURNS boolean
--   SECURITY DEFINER, body: RETURN pgmq.delete(queue_name, message_id);
--
-- No allow-list, no authorization check. `queue_name` is caller-controlled
-- and `pgmq.delete` accepts ANY existing queue name, including
-- `auth_emails` — the same queue `read_email_batch`'s own migration header
-- already documents as carrying pending authentication mail. Message ids are
-- sequential bigints (guessable). An anonymous caller naming `auth_emails`
-- and iterating ids can silently discard pending password-reset and signup
-- mail before `process-email-queue` ever reads it — a denial-of-delivery
-- primitive, not merely a disclosure risk (this function returns only a
-- boolean, so it is not itself a read primitive the way `read_email_batch`
-- is).
--
-- Unlike `enqueue_email`/`read_email_batch`/`move_to_dlq`, this migration
-- does NOT add a queue allow-list to the body. `delete_email` takes a single
-- queue name with no destination queue to confuse it with, so the allow-list
-- pattern used for the other three (guarding against an attacker naming an
-- unexpected queue as a SOURCE while a second, trusted queue is the
-- DESTINATION) does not apply here in the same way, and the fix that matters
-- is the grant. The body is left byte-identical to what is live today —
-- confirmed via `pg_get_functiondef` immediately before authoring this file.
-- This migration changes privileges only.
--
-- ───────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS — MEASURED, NOT ASSUMED
--
-- Every caller of delete_email, and the identity it calls with, `git grep`
-- across src/, supabase/functions/, functions/, tests/, scripts/, this
-- session:
--
--   supabase/functions/process-email-queue/index.ts:271   SERVICE_ROLE_KEY
--   supabase/functions/process-email-queue/index.ts:355   SERVICE_ROLE_KEY
--
-- Both call sites are in the same edge function, whose Supabase client is
-- constructed at process-email-queue/index.ts:116 with
-- `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` — read directly from the file,
-- not cited from a comment. `src/` has zero references beyond the generated
-- `types.ts` type stub, which is not a call.
--
-- Legitimate callers losing access: ZERO.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;

COMMENT ON FUNCTION public.delete_email(text, bigint) IS
  'P32 mail group. SECURITY DEFINER queue-delete wrapper around pgmq.delete(). Privileged-only: no anon/authenticated caller should ever hold EXECUTE, since it permits discarding any message on any named queue by id with no authorization check, including q_auth_emails. Only process-email-queue (service_role) calls it. Grant closed 2026-09-17; the earlier FROM PUBLIC-only revoke in 20260322151646_email_infra.sql was an F-62 no-op against the named anon/authenticated grants added by ALTER DEFAULT PRIVILEGES.';

COMMIT;
