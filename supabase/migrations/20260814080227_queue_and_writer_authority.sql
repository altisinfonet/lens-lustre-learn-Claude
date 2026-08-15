-- ═══════════════════════════════════════════════════════════════════════════
-- THE THIRD QUEUE FUNCTION, AND THREE WRITERS NOBODY CALLS FROM A BROWSER.
--
-- 20260814042609 closed `enqueue_email` and `read_email_batch`. It did not close
-- `move_to_dlq`, because that migration's scope was the two functions the audit
-- had named. The Phase A SECURITY DEFINER inventory found the third.
--
-- ⚠ THAT IS THE LESSON, NOT THE BUG. A fix scoped to the instances already
-- found leaves the rest of the class in place. `20260322151646_email_infra.sql`
-- created all three together; two were revoked and one was not.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY move_to_dlq IS THE SERIOUS ONE
--
--   CREATE OR REPLACE FUNCTION public.move_to_dlq(
--     source_queue text, dlq_name text, message_id bigint, payload jsonb)
--   RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER ...
--   BEGIN
--     SELECT pgmq.send(dlq_name, payload) INTO new_id;
--     PERFORM pgmq.delete(source_queue, message_id);   ← ANY queue, ANY id
--     ...
--     EXCEPTION WHEN undefined_table THEN PERFORM pgmq.create(dlq_name);
--
-- SECURITY DEFINER, `has_function_privilege('anon', …) = true`, and no
-- authorization check of any kind. Reachable at /rest/v1/rpc/move_to_dlq with
-- the public anon key. It permits, from an anonymous caller:
--
--   * `pgmq.delete(source_queue, message_id)` on ANY queue — including
--     `q_auth_emails`. Message ids are sequential bigints, so they are
--     guessable. This is targeted denial of password-reset and signup email.
--   * arbitrary queue creation (`pgmq.create`), i.e. unbounded real tables.
--   * arbitrary message injection into any queue.
--
-- ⚠ NOT verified by exploitation. Deleting a real message would have destroyed
-- a member's authentication email. The finding rests on the definition and the
-- ACL, both read from production.
--
-- It was also detected in May and frozen: `rls-authority-baseline.json` carries
-- `SECDEF_NO_AUTH_GUARD:public.move_to_dlq` from `email_infra.sql:166`, while
-- `security-audit.mjs` — a different scanner that never reads that file —
-- reports 0 critical / 0 high.
--
-- ───────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS — MEASURED
--
--   move_to_dlq            supabase/functions/process-email-queue/index.ts:72   SERVICE_ROLE
--   _ensure_stats_row      trg_follows_counts, trg_friendships_counts — both SECURITY DEFINER, owner postgres
--   log_push_outcome       no caller in src/ or supabase/functions/
--   wallet_ledger_v2_diff_snapshot  no caller except the generated types.ts entry
--
-- Both `_ensure_stats_row` callers are SECURITY DEFINER owned by `postgres`, so
-- they execute as the owner and are unaffected by a revoke from `authenticated`.
-- That was checked specifically: a SECURITY INVOKER trigger caller would have
-- made this migration fail a member's follow or friend request while still
-- working for the owner running it.
--
-- Legitimate callers losing access: ZERO.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THE OTHER THREE ARE HERE TOO
--
-- None is as sharp as move_to_dlq, and none is a browser API:
--
--   _ensure_stats_row(uuid)              INSERT a stats row for ANY uuid — unbounded row creation
--   log_push_outcome(uuid,uuid,…)        writes a log row with caller-controlled user, type and detail — log poisoning
--   wallet_ledger_v2_diff_snapshot(interval)  writes a wallet reconciliation snapshot on demand
--
-- All four are named explicitly rather than swept, because `REVOKE … FROM
-- PUBLIC` alone does not remove a grant held by a NAMED role — that is exactly
-- why `email_infra.sql:195` did not hold for two years.
--
-- Deliberately NOT in this migration, having been checked and found gated or
-- scoped: `record_test_agent_run` (validates its own token),
-- `increment_managed_page_view` (scoped UPDATE … WHERE),
-- `recompute_entry_public_status` (scoped, derives state it could already read).
-- The broader default-privileges change (M2) remains its own reviewed cycle.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. move_to_dlq: allow-list the queues, exactly as enqueue_email/read_email_batch.
CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue text, dlq_name text, message_id bigint, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE new_id BIGINT;
BEGIN
  -- Named queues only, on BOTH sides. The source guard is the one that matters:
  -- without it, pgmq.delete() below reaches any queue in the system.
  IF source_queue IS NULL OR source_queue NOT IN ('transactional_emails', 'auth_emails')
     OR dlq_name IS NULL OR dlq_name NOT IN ('transactional_emails_dlq', 'auth_emails_dlq') THEN
    RAISE EXCEPTION 'move_to_dlq: % -> % is not a permitted queue pair',
      coalesce(source_queue, '<null>'), coalesce(dlq_name, '<null>')
      USING ERRCODE = '42501';
  END IF;

  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION
  -- Reachable only for an allow-listed pair, because the check above passed.
  WHEN undefined_table THEN
    BEGIN
      PERFORM pgmq.create(dlq_name);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    SELECT pgmq.send(dlq_name, payload) INTO new_id;
    BEGIN
      PERFORM pgmq.delete(source_queue, message_id);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
    RETURN new_id;
END;
$function$;

-- ── 2. The grants. Named roles, not just PUBLIC — see the header.
REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public._ensure_stats_row(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_stats_row(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.log_push_outcome(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_push_outcome(uuid, uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_diff_snapshot(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_snapshot(interval) TO service_role;

COMMIT;
