-- P5-b fixture — SCRATCH CLUSTER ONLY (database p5cron = cron.database_name).
-- REAL pg_cron 1.6. public.scheduled_posts: columns and indexes VERBATIM from
-- staging fpszggreishhuvdpkmdr (information_schema + pg_indexes, read-only,
-- 2026-10-04). STUBS, stated: vault (a table, decrypted_secrets view and
-- create_secret with the real signature; vault._decrypt counts reads) and pg_net
-- (net.http_post with the real signature, recording instead of sending).
-- The cron job has PRODUCTION's shape (Owner's read, 2026-10-04: the secret read
-- from vault.decrypted_secrets inline) with INVENTED values.
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

-- ── public.scheduled_posts, as on staging ──
CREATE TABLE public.scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content text, image_urls text[], image_url text,
  tagged_user_ids uuid[], scheduled_for timestamptz NOT NULL, original_scheduled_for timestamptz, status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0, shifted_count integer NOT NULL DEFAULT 0, last_shift_reason text, last_error text,
  published_post_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  privacy text, indexing_disabled boolean, categories text[], thumbnail_urls text[], media_ids uuid[]);
CREATE INDEX idx_scheduled_posts_pending_due ON public.scheduled_posts USING btree (scheduled_for) WHERE (status = 'pending'::text);
CREATE INDEX idx_scheduled_posts_user_status_time ON public.scheduled_posts USING btree (user_id, status, scheduled_for DESC);

-- ── the job: production's shape, invented values ──
SELECT vault.create_secret('fixture-scheduled-posts-secret-2222', 'fixture_scheduled_posts_cron_secret');
SELECT cron.schedule('publish-scheduled-posts', '* * * * *', $cmd$
 select net.http_post(
 url := 'https://fixture-not-a-project.supabase.co/functions/v1/publish-scheduled-posts',
 headers := jsonb_build_object(
 'Content-Type','application/json',
 'Authorization','Bearer FIXTURE-NOT-A-SECRET-0000000000',
 'x-scheduled-posts-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fixture_scheduled_posts_cron_secret')),
 body := '{}'::jsonb) $cmd$);
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'publish-scheduled-posts';
