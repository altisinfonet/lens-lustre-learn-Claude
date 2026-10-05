-- ═══════════════════════════════════════════════════════════════════════════
-- P9 → P5-b · 20261004_0006 — the e-mail queue: woken by an event, idle back-off,
-- no secret in the cron command. Plus the delete_email queue allow-list (A-P9-3).
-- Phase 3 units P9 + P5 clause 2 (D1, T1). Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IS THERE TODAY (production, the Owner's read, 2026-10-04 ~15:10 UTC,
-- claude/2026-10-04-OWNER-P9-P5-PRODUCTION-READ-result.md):
--   cron job 'process-email-queue', schedule '10 seconds', command
--   "select net.http_post(url := '<edge fn>', headers := {service key,
--   x-cron-secret}, …)" — 8,640 HTTP calls a day to the edge function whether
--   or not one e-mail is queued (A-P9-1), with the secrets as LITERALS in the
--   command, so every run copies them into cron.job_run_details (F-P6-1).
--   It is not in git. On staging the job does not exist (read 2026-10-04).
--
-- WHAT THIS FILE DOES
--   1. MOVES THE HTTP TARGET OUT OF THE COMMAND, INSIDE THE DATABASE. The job's
--      own net.http_post(...) arguments are evaluated once, by this file, into
--      vault secret 'p9_cron_http:process-email-queue' (url, headers, body,
--      params, timeout). No person and no file sees them: the command text is
--      re-pointed at pg_temp.p9_capture(...), a function with net.http_post's
--      exact parameter names, and EXECUTEd. The previous schedule and command
--      go to vault secret 'p9_cron_previous:process-email-queue' so the
--      rollback restores them byte for byte. (The command carries secrets, so
--      it is never copied into a table.)
--   2. WOKEN BY AN EVENT. Statement-level triggers on pgmq.q_auth_emails and
--      pgmq.q_transactional_emails call public.email_queue_wake():
--        AFTER INSERT  (an enqueue)        → wake, at commit (pg_net sends after
--                                            commit; a rolled-back enqueue sends
--                                            nothing);
--        AFTER UPDATE  (pgmq.read claims)  → records that the worker has read,
--                                            which clears the outstanding wake;
--        AFTER DELETE  (a message done)    → wake again if visible work remains
--                                            AND no message is still claimed —
--                                            i.e. at the worker's LAST delete of
--                                            its batch. A backlog drains batch
--                                            after batch, one worker at a time,
--                                            instead of 20 messages per tick.
--      ONE OUTSTANDING WAKE: no new wake while a previous one has not been read
--      (30-s guard for a lost one), none while a batch is claimed, none while the
--      sender is rate-limited (email_send_state.retry_after_until). Decisions
--      are serialised by one transaction-scoped advisory lock, taken BEFORE the
--      queue is looked at. An enqueue only TRIES it (SEC-P9-1: enqueues never
--      wait on one another); a skipped enqueue-wake is covered by the batch-end
--      wake, or — the one race left — by the minute tick (≤ 60 s).
--      A wake failure NEVER fails the enqueue, read or delete: the trigger traps
--      it, raises a WARNING, and the minute sweep picks the work up.
--   3. IDLE BACK-OFF. The job becomes '* * * * *' calling
--      public.email_queue_tick(): one index probe per queue; no HTTP call and no
--      vault read unless a message is visible and unclaimed. It is the safety
--      net for a lost wake; it is not the delivery path.
--   4. delete_email(text, bigint) gets the same queue allow-list as
--      enqueue_email / read_email_batch / move_to_dlq (A-P9-3, LOW: its ACL is
--      postgres + service_role only; defence in depth). Its previous definition
--      is saved for the rollback.
--
-- LATENCY, STATED: an e-mail enqueued while the worker is idle is handed to it at
-- commit (was: up to 10 s). One enqueued while a batch is being sent goes in the
-- next batch, woken by that batch's last delete. The minute sweep is reached only
-- when a wake is lost (HTTP failure, worker crash) or after a rate-limit pause.
-- Measured in docs/evidence/d1/P9/.
-- VAULT, STATED (P9 gate): the vault is read only when an HTTP call is actually
-- made — never on an idle tick — so lookups = wakes, not 8,640 a day.
--
-- WHAT IT DOES NOT DO: the edge function is unchanged; the other HTTP cron jobs
-- (apply-scheduled-boosts, autoscale-ad-traffic, expire-gift-credits,
-- judging-invariants-nightly, send-reengagement-emails, backup-reminder) keep
-- their literal headers — PROBE_p9_email_queue_wake.sql lists them as OPEN (P9-c).
--
-- OBJECTS (reservation): new public.email_queue_wake_state,
-- public.email_queue_has_work(text), public.email_queue_wake(text),
-- public.email_queue_tick(), public.email_queue_wake_trg(); triggers
-- p9_email_wake on pgmq.q_auth_emails / pgmq.q_transactional_emails; vault
-- secrets p9_cron_http:process-email-queue, p9_cron_previous:process-email-queue;
-- cron job 'process-email-queue' (schedule + command); public.delete_email body.
-- NOT RE-RUNNABLE: PRE-003 refuses once email_queue_wake exists.
-- F-AUD-2 FIX-UP (2026-10-05): this file failed twice on staging (runs #128,
-- #131) at POST-002 — a ::regclass cast of the absent pgmq.q_auth_emails, folded
-- at plan time — and rolled back whole; it has been applied NOWHERE, so it is
-- corrected in place rather than superseded (no phantom ordinal). Same fix in
-- the PROBE (E2). The rollback needed none (DROP TRIGGER IF EXISTS … ON an absent
-- table only notices; proved on the staging shape).
-- ROLLBACK: supabase/rollback/20261004_0006_p9_email_queue_wake_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_p9_email_queue_wake.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  j record;
BEGIN
  -- PRE-001 · the machinery this file uses exists.
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('pgmq') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('public.delete_email(text,bigint)') IS NULL
     OR to_regclass('public.email_send_state') IS NULL THEN
    RAISE EXCEPTION 'P9-0006-PRE-001: cron, pgmq, net.http_post, vault, public.delete_email or public.email_send_state is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · at most one process-email-queue job, and if present it is exactly
  -- one "select net.http_post(...)" — the shape the capture below can evaluate.
  SELECT count(*) AS n, max(command) AS command INTO j FROM cron.job WHERE jobname = 'process-email-queue';
  IF j.n > 1 OR (j.n = 1 AND (
       j.command !~* '^\s*select\s+net\.http_post\s*\('
    OR (SELECT count(*) FROM regexp_matches(j.command, 'http_post', 'gi')) <> 1
    OR rtrim(j.command, E' \t\r\n;') ~ ';')) THEN
    -- the command itself is not printed: it carries secrets.
    RAISE EXCEPTION 'P9-0006-PRE-002: % process-email-queue job(s); expected 0 or 1 whose command is a single "select net.http_post(...)"', j.n
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · not applied already; the vault names are free.
  IF to_regprocedure('public.email_queue_wake(text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name IN ('p9_cron_http:process-email-queue', 'p9_cron_previous:process-email-queue')) THEN
    RAISE EXCEPTION 'P9-0006-PRE-003: 20261004_0006 is already applied (email_queue_wake or its vault secrets exist)'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. state: one row; the counters are the measurement ────────────────────
CREATE TABLE public.email_queue_wake_state (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_wake_at        timestamptz,
  last_read_at        timestamptz,
  wakes               bigint NOT NULL DEFAULT 0,
  idle_ticks          bigint NOT NULL DEFAULT 0,
  prev_delete_email   text NOT NULL,
  applied_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_queue_wake_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_queue_wake_state FROM PUBLIC;
REVOKE ALL ON public.email_queue_wake_state FROM anon;
REVOKE ALL ON public.email_queue_wake_state FROM authenticated;
INSERT INTO public.email_queue_wake_state (prev_delete_email)
VALUES (pg_get_functiondef('public.delete_email(text,bigint)'::regprocedure));

-- ── 2. the queue's state (index probes on vt only; no HTTP, no vault) ───────
--   'work'     a message is visible (vt <= now) and the sender is not rate-limited
--   'claimed'  a message is invisible (vt > now): a worker holds a batch
CREATE FUNCTION public.email_queue_has_work(_what text DEFAULT 'work')
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _q   text;
  _hit boolean;
BEGIN
  IF _what = 'work' AND EXISTS (SELECT 1 FROM public.email_send_state WHERE retry_after_until > clock_timestamp()) THEN
    RETURN false;                                   -- rate-limited: the sender would skip anyway
  END IF;
  FOREACH _q IN ARRAY ARRAY['q_auth_emails', 'q_transactional_emails'] LOOP
    IF to_regclass('pgmq.' || _q) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM pgmq.%I WHERE vt %s clock_timestamp())',
                     _q, CASE WHEN _what = 'claimed' THEN '>' ELSE '<=' END) INTO _hit;
      IF _hit THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$fn$;

-- ── 3. the wake: lock → read? → work? → claimed? → outstanding? → vault → HTTP
CREATE FUNCTION public.email_queue_wake(_source text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _t jsonb;
  _s record;
BEGIN
  -- Serialise every decision. Taken before the queue is looked at, so each
  -- caller sees what the previous one committed.
  -- SEC-P9-1: an ENQUEUE never waits for it. If another transaction holds it,
  -- that holder is deciding a wake already (or is the worker, whose last delete
  -- re-checks the queue); the one race left — the worker's last delete deciding
  -- before this enqueue commits — is picked up by the minute tick (≤ 60 s).
  -- The worker's read/delete and the tick still wait, briefly, so their
  -- decision always sees the latest committed state.
  IF _source = 'insert' THEN
    IF NOT pg_try_advisory_xact_lock(hashtext('p9:process-email-queue')) THEN
      RETURN 'lock busy';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('p9:process-email-queue'));
  END IF;
  IF _source = 'update' THEN
    UPDATE public.email_queue_wake_state SET last_read_at = clock_timestamp();
    RETURN 'read';
  END IF;
  IF NOT public.email_queue_has_work('work') THEN
    IF _source = 'tick' THEN
      UPDATE public.email_queue_wake_state SET idle_ticks = idle_ticks + 1;
    END IF;
    RETURN 'idle';
  END IF;
  IF public.email_queue_has_work('claimed') THEN
    RETURN 'busy';                                  -- that batch's last delete wakes the next
  END IF;
  SELECT last_wake_at, last_read_at INTO _s FROM public.email_queue_wake_state;
  IF _s.last_wake_at > coalesce(_s.last_read_at, '-infinity'::timestamptz)
     AND _s.last_wake_at > clock_timestamp() - interval '30 seconds' THEN
    RETURN 'outstanding';                           -- woken, not yet read
  END IF;
  SELECT decrypted_secret::jsonb INTO _t FROM vault.decrypted_secrets
   WHERE name = 'p9_cron_http:process-email-queue';
  IF _t IS NULL THEN
    RETURN 'no target';                             -- a lane with no worker wired (staging today)
  END IF;
  PERFORM net.http_post(url := _t->>'url', body := coalesce(_t->'body', '{}'::jsonb),
                        params := coalesce(_t->'params', '{}'::jsonb), headers := _t->'headers',
                        timeout_milliseconds := coalesce((_t->>'timeout_milliseconds')::int, 5000));
  UPDATE public.email_queue_wake_state SET last_wake_at = clock_timestamp(), wakes = wakes + 1;
  RETURN 'woken';
END;
$fn$;

CREATE FUNCTION public.email_queue_tick()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $fn$ SELECT public.email_queue_wake('tick'); $fn$;

-- The trigger never fails the statement that fired it (an enqueue or a delete).
CREATE FUNCTION public.email_queue_wake_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  BEGIN
    PERFORM public.email_queue_wake(lower(TG_OP));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_queue_wake failed (% on %): % — the minute sweep will pick it up', TG_OP, TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_queue_has_work(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_wake(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_wake_trg() FROM PUBLIC, anon, authenticated;

DO $triggers$
DECLARE _q text;
BEGIN
  FOREACH _q IN ARRAY ARRAY['q_auth_emails', 'q_transactional_emails'] LOOP
    IF to_regclass('pgmq.' || _q) IS NOT NULL THEN
      EXECUTE format('CREATE TRIGGER p9_email_wake AFTER INSERT OR UPDATE OR DELETE ON pgmq.%I '
                     'FOR EACH STATEMENT EXECUTE FUNCTION public.email_queue_wake_trg()', _q);
      RAISE NOTICE 'P9-0006: wake trigger on pgmq.%', _q;
    ELSE
      RAISE NOTICE 'P9-0006: pgmq.% does not exist on this lane — no trigger (PROBE fails if it appears without one)', _q;
    END IF;
  END LOOP;
END
$triggers$;

-- ── 4. delete_email: the same allow-list as its three siblings ─────────────
CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Named queues only (A-P9-3). Without this, pgmq.delete() reaches any queue.
  IF queue_name IS NULL OR queue_name NOT IN ('transactional_emails', 'auth_emails') THEN
    RAISE EXCEPTION 'delete_email: queue % is not permitted', coalesce(queue_name, '<null>')
      USING ERRCODE = '42501';
  END IF;

  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$function$;

-- ── 5. the job: target into vault, then once a minute calling the tick ─────
DO $move$
DECLARE
  j  record;
  _t jsonb;
BEGIN
  SELECT schedule, command INTO j FROM cron.job WHERE jobname = 'process-email-queue';
  IF NOT FOUND THEN
    RAISE NOTICE 'P9-0006: no process-email-queue job on this lane — none created (wakes return "no target")';
    RETURN;
  END IF;
  -- net.http_post's exact parameter names and defaults (pg_net 0.20.4).
  CREATE FUNCTION pg_temp.p9_capture(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
                                     headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb,
                                     timeout_milliseconds integer DEFAULT 5000)
  RETURNS jsonb LANGUAGE sql AS
  $c$ SELECT jsonb_build_object('url', url, 'body', body, 'params', params, 'headers', headers,
                                'timeout_milliseconds', timeout_milliseconds) $c$;
  EXECUTE regexp_replace(rtrim(j.command, E' \t\r\n;'), 'net\.http_post\s*\(', 'pg_temp.p9_capture(', 'i') INTO _t;
  IF _t->>'url' IS NULL OR _t->>'url' !~ '/functions/v1/process-email-queue' THEN
    RAISE EXCEPTION 'P9-0006-MOVE-001: the captured url is not the process-email-queue edge function'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM vault.create_secret(_t::text, 'p9_cron_http:process-email-queue',
          'P9 · 20261004_0006 · HTTP target of cron job process-email-queue (moved out of the command)');
  PERFORM vault.create_secret(jsonb_build_object('schedule', j.schedule, 'command', j.command)::text,
          'p9_cron_previous:process-email-queue',
          'P9 · 20261004_0006 · the job before 0006, for the rollback only');
  PERFORM cron.schedule('process-email-queue', '* * * * *', 'SELECT public.email_queue_tick();');
  DROP FUNCTION pg_temp.p9_capture(text, jsonb, jsonb, jsonb, integer);
END
$move$;

DO $postconditions$
DECLARE
  j record;
  _q text;
  _bad int;
BEGIN
  SELECT count(*) AS n, max(schedule) AS schedule, max(command) AS command INTO j
    FROM cron.job WHERE jobname = 'process-email-queue';
  IF j.n = 1 AND (j.schedule <> '* * * * *' OR j.command <> 'SELECT public.email_queue_tick();'
                  OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'p9_cron_http:process-email-queue')
                  OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:process-email-queue')) THEN
    RAISE EXCEPTION 'P9-0006-POST-001: process-email-queue is not once a minute calling email_queue_tick() with its target in vault'
      USING ERRCODE = 'raise_exception';
  END IF;
  FOREACH _q IN ARRAY ARRAY['q_auth_emails', 'q_transactional_emails'] LOOP
    -- F-AUD-2: nested IF and to_regclass() only. An `x IS NOT NULL AND NOT EXISTS
    -- (… ('pgmq.'||_q)::regclass …)` is planned as ONE expression: the cast is
    -- folded at plan time and raises for an absent queue (staging runs #128/#131).
    IF to_regclass('pgmq.' || _q) IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('pgmq.' || _q)
                        AND tgname = 'p9_email_wake' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'P9-0006-POST-002: pgmq.% has no enabled p9_email_wake trigger', _q USING ERRCODE = 'raise_exception';
      END IF;
    END IF;
  END LOOP;
  BEGIN
    PERFORM public.delete_email('post_jobs', 0);
    RAISE EXCEPTION 'P9-0006-POST-003: delete_email accepted queue post_jobs' USING ERRCODE = 'raise_exception';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO _bad FROM (VALUES ('public.email_queue_has_work(text)'), ('public.email_queue_wake(text)'),
                                         ('public.email_queue_tick()'), ('public.email_queue_wake_trg()')) f(sig)
   WHERE has_function_privilege('anon', f.sig, 'EXECUTE') OR has_function_privilege('authenticated', f.sig, 'EXECUTE');
  IF _bad > 0 OR has_table_privilege('anon', 'public.email_queue_wake_state', 'SELECT')
     OR has_table_privilege('authenticated', 'public.email_queue_wake_state', 'SELECT') THEN
    RAISE EXCEPTION 'P9-0006-POST-004: a new function or the state table is reachable by an API role' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P9-0006: e-mail queue woken by enqueue and by the last delete of a batch, idle back-off once a minute, target in vault, delete_email allow-listed';
END
$postconditions$;

COMMIT;
