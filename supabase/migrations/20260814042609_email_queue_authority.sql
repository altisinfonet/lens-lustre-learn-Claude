-- ═══════════════════════════════════════════════════════════════════════════
-- THE EMAIL QUEUE IS NOT A PUBLIC API.
--
-- Read from production 2026-08-13, with has_function_privilege:
--
--   public.enqueue_email(text, jsonb)          anon=TRUE  authenticated=TRUE
--   public.read_email_batch(text, int, int)    anon=TRUE  authenticated=TRUE
--
-- Both are SECURITY DEFINER. Neither performs any authorization check. Both
-- are reachable from a browser with the public anon key at
-- /rest/v1/rpc/<name>.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT read_email_batch RETURNS, AND WHY IT IS THE MORE SERIOUS OF THE TWO
--
--   RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
--   ... SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
--
-- `message` is the whole payload. The live queues are `q_auth_emails` and
-- `q_transactional_emails` — auth_emails is filled by the
-- `auth-email-hook` edge function, so its payloads are the bodies of
-- authentication mail. An anonymous caller naming that queue reads pending
-- authentication messages for other members.
--
-- It is also a delivery outage, not only a disclosure: `pgmq.read` sets a
-- visibility timeout, so a caller passing a large `vt` hides live messages
-- from `process-email-queue` for that long. Read the queue in a loop and no
-- member receives mail.
--
-- ⚠ This was NOT verified by reading the queue. Doing so would have exposed
-- real members' tokens to the session performing the audit and would have set
-- visibility timeouts on live messages. The finding rests on the function
-- definition, the ACL, and has_function_privilege — all read from production.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THIS IS A REVERT, NOT A NEW RULE
--
-- `20260322151646_email_infra.sql:193-199` already did exactly this, with a
-- comment naming the exact risk:
--
--     -- Restrict queue RPC wrappers to service_role only (SECURITY DEFINER
--     -- runs as owner, so without this any authenticated user could
--     -- manipulate the email queues)
--     REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
--     GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
--     REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
--     GRANT  EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;
--
-- The protection was written, correctly, and then lost.
--
-- HOW IT WAS LOST, measured:
--
--     select defaclobjtype, array_to_string(defaclacl,' | ')
--     from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
--     where n.nspname='public';
--     -- f | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- ALTER DEFAULT PRIVILEGES grants EXECUTE on every function created in
-- `public` to anon and authenticated. `REVOKE ... FROM PUBLIC` does not
-- remove a grant held by a NAMED role, so the original revoke never touched
-- these two, and any later DROP/CREATE re-applies the default anyway.
--
-- ⚠ THEREFORE THE GRANT ALONE IS NOT A DURABLE DEFENCE. It has already failed
-- once. The allow-list below is what survives the next accident, and it is
-- why this migration changes the bodies as well as the grants.
--
-- The default-privileges change itself is deliberately NOT in this file. It
-- affects every function in the schema, it can blank a feature for real
-- members while still working for the owner, and it needs its own branch test
-- and its own reviewed migration.
--
-- ───────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS — MEASURED, NOT ASSUMED
--
-- Every caller of either function, and the identity it calls with:
--
--   supabase/functions/send-transactional-email/index.ts:335  SERVICE_ROLE_KEY
--   supabase/functions/auth-email-hook/index.ts:253           SERVICE_ROLE_KEY
--   supabase/functions/process-email-queue/index.ts:174       SERVICE_ROLE_KEY
--   public.emit_notification()        SECURITY DEFINER, owner postgres
--   public.send_notification_email()  SECURITY DEFINER, owner postgres
--   src/  — none. The only occurrence is the generated types.ts entry.
--
-- Both database callers are SECURITY DEFINER owned by postgres, so they
-- execute as the owner and are unaffected by a revoke from `authenticated`.
-- That was checked specifically: a SECURITY INVOKER caller would have made
-- this migration fail a member's INSERT — signup or posting — while still
-- working for the owner running it.
--
-- Legitimate callers losing access: ZERO.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY AN ALLOW-LIST AND NOT AN auth.uid() CHECK
--
-- An `auth.role()`/`auth.uid()` gate would BREAK the two trigger callers.
-- `emit_notification` fires inside an ordinary member's transaction, so
-- auth.role() is 'authenticated' there — a role check would reject exactly
-- the caller that must keep working. The grant is the authorization control;
-- the allow-list is the blast-radius control.
--
-- The allow-list is the three queues that exist in production:
-- `pgmq.q_transactional_emails`, `pgmq.q_auth_emails`, `pgmq.q_post_jobs`.
-- `post_jobs` is enqueued by `enqueue_post_job(jsonb)`, which is already
-- correctly revoked from anon and authenticated — proof that an explicit
-- revoke does stick when it names the roles.
--
-- Removing the unbounded `pgmq.create(queue_name)` also closes the second
-- half of the original finding: an anonymous caller could create unlimited
-- real tables by naming queues that did not exist.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. enqueue_email: allow-list the queue, keep create-if-missing for it ──

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Named queues only. Everything else is rejected before pgmq is touched,
  -- so an unrecognised name can no longer create a table as a side effect.
  IF queue_name IS NULL OR queue_name NOT IN ('transactional_emails', 'auth_emails') THEN
    RAISE EXCEPTION 'enqueue_email: queue % is not permitted', coalesce(queue_name, '<null>')
      USING ERRCODE = '42501';
  END IF;

  RETURN pgmq.send(queue_name, payload);
EXCEPTION
  -- Reachable only for an allow-listed name, because the check above already
  -- passed. Preserves the original create-if-missing resilience without the
  -- arbitrary-table-creation half of it.
  WHEN undefined_table THEN
    PERFORM pgmq.create(queue_name);
    RETURN pgmq.send(queue_name, payload);
END;
$function$;

-- ── 2. read_email_batch: same allow-list, and no silent queue creation ─────

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF queue_name IS NULL OR queue_name NOT IN ('transactional_emails', 'auth_emails') THEN
    RAISE EXCEPTION 'read_email_batch: queue % is not permitted', coalesce(queue_name, '<null>')
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message
               FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION
  WHEN undefined_table THEN
    -- A consumer reading a queue that does not exist gets nothing. It must not
    -- create one: the reader is not the producer, and creating here is how an
    -- unrecognised name became a table.
    RETURN;
END;
$function$;

-- ── 3. The grants ─────────────────────────────────────────────────────────
--
-- `FROM PUBLIC` alone is what failed in 20260322151646 — it does not remove a
-- grant held by a named role. anon and authenticated are named explicitly.

REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer)  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)               TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;

COMMIT;
