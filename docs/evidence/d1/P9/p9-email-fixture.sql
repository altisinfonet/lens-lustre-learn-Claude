-- P9 → P5-b e-mail fixture — SCRATCH CLUSTER ONLY (database p5cron = cron.database_name).
-- REAL pg_cron 1.6 and REAL pgmq 1.5.1 (staging and production run pgmq 1.5.1).
-- VERBATIM from staging fpszggreishhuvdpkmdr (pg_get_functiondef, read-only,
-- 2026-10-04): enqueue_email, read_email_batch, move_to_dlq, delete_email and
-- email_send_state's columns.
-- STUBS, stated: vault (supabase_vault 0.3.1 is not installable here) — a table,
-- a decrypted_secrets view and create_secret with the real signature, plus a
-- counter function vault._decrypt so a test can see how often it is read;
-- pg_net — net.http_post with the real signature (pg_net 0.20.4) that records
-- the request in net.http_request_queue instead of sending it. Like pg_net, a
-- request made in a rolled-back transaction is never "sent".
-- The cron job has production's SHAPE (Owner's read, 2026-10-04) with
-- INVENTED values: nothing here is a real URL, key or secret.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $r$;

-- ── vault (stub) ──
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text NOT NULL DEFAULT '',
  secret text NOT NULL, key_id uuid, nonce bytea, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets (name) WHERE name IS NOT NULL;
CREATE FUNCTION vault._decrypt(text) RETURNS text LANGUAGE plpgsql AS $f$ BEGIN RETURN $1; END $f$;
CREATE VIEW vault.decrypted_secrets AS SELECT s.*, vault._decrypt(s.secret) AS decrypted_secret FROM vault.secrets s;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL::text, new_description text DEFAULT ''::text, new_key_id uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE sql AS $f$ INSERT INTO vault.secrets (secret, name, description, key_id) VALUES (new_secret, new_name, new_description, new_key_id) RETURNING id $f$;

-- ── pg_net (stub) ──
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, url text, body jsonb, params jsonb, headers jsonb,
  timeout_milliseconds int, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), done boolean NOT NULL DEFAULT false);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO net.http_request_queue (url, body, params, headers, timeout_milliseconds)
  VALUES (url, body, params, headers, timeout_milliseconds) RETURNING id $f$;

-- ── e-mail infrastructure, verbatim from staging ──
CREATE TABLE public.email_send_state (id integer PRIMARY KEY DEFAULT 1, retry_after_until timestamptz, batch_size integer NOT NULL DEFAULT 10,
  send_delay_ms integer NOT NULL DEFAULT 200, auth_email_ttl_minutes integer NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes integer NOT NULL DEFAULT 60, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.email_send_state DEFAULT VALUES;
SELECT pgmq.create('auth_emails'); SELECT pgmq.create('transactional_emails');
SELECT pgmq.create('auth_emails_dlq'); SELECT pgmq.create('transactional_emails_dlq');

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

CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb), public.read_email_batch(text, integer, integer),
  public.delete_email(text, bigint) TO service_role;

-- What the simulated worker "sent" (one row per message), for the drain tests.
CREATE TABLE public.sim_sent (msg_id bigint, queue text, enqueued_at timestamptz, sent_at timestamptz DEFAULT clock_timestamp(), request_id bigint);

-- ── the job: production's shape, invented values ──
SELECT cron.schedule('process-email-queue', '10 seconds', $cmd$
 select net.http_post(
 url := 'https://fixture-not-a-project.supabase.co/functions/v1/process-email-queue',
 headers := jsonb_build_object(
 'Content-Type','application/json',
 'Authorization','Bearer FIXTURE-NOT-A-SECRET-0000000000',
 'x-cron-secret','fixture-not-a-secret-1111111111'),
 body := '{}'::jsonb) $cmd$);
