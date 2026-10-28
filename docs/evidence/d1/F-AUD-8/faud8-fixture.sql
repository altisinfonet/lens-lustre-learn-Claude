-- F-AUD-8 fixture, part 1 (before 0003) — SCRATCH CLUSTER ONLY (database p5cron).
-- REAL pg_cron 1.6. STUBS with their real signatures: vault (supabase_vault 0.3.1:
-- secrets, decrypted_secrets, create_secret, update_secret) and pg_net 0.20.4
-- (http_post records the request in net.http_request_queue).
-- Shapes from the lanes, values INVENTED (psql variables set by the harness;
-- nothing here is a real key or secret):
--   production: the six HTTP jobs (Owner's read 2026-10-04) as literal
--               "select net.http_post(...)" with Authorization: Bearer <key> and
--               x-cron-secret; plus process-email-queue (0006) and
--               publish-scheduled-posts (P5-b, inline vault read) — part 2.
--   staging:    apply-scheduled-boosts, expire-gift-credits,
--               judging-invariants-nightly + publish-scheduled-posts; no
--               process-email-queue (staging read 2026-10-10 07:5x UTC).
-- psql variables: shape, old_key, old_cs, sp_secret.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $r$;

CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text NOT NULL DEFAULT '',
  secret text NOT NULL, key_id uuid, nonce bytea, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets (name) WHERE name IS NOT NULL;
CREATE VIEW vault.decrypted_secrets AS SELECT s.*, s.secret AS decrypted_secret FROM vault.secrets s;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL::text, new_description text DEFAULT ''::text, new_key_id uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE sql AS $f$ INSERT INTO vault.secrets (secret, name, description, key_id) VALUES (new_secret, new_name, new_description, new_key_id) RETURNING id $f$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL::text, new_name text DEFAULT NULL::text,
  new_description text DEFAULT NULL::text, new_key_id uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE sql AS $f$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
  description = coalesce(new_description, description), key_id = coalesce(new_key_id, key_id), updated_at = now() WHERE id = secret_id $f$;

CREATE SCHEMA net;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, url text, body jsonb, params jsonb, headers jsonb,
  timeout_milliseconds int, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO net.http_request_queue (url, body, params, headers, timeout_milliseconds)
  VALUES (url, body, params, headers, timeout_milliseconds) RETURNING id $f$;

-- app objects the moved jobs call (bodies irrelevant here)
CREATE FUNCTION public.email_queue_tick() RETURNS text LANGUAGE sql AS $f$ SELECT 'idle' $f$;
CREATE FUNCTION public.publish_scheduled_posts_tick() RETURNS text LANGUAGE sql AS $f$ SELECT 'idle' $f$;
CREATE FUNCTION public.rollup_engagement_daily(date) RETURNS void LANGUAGE sql AS 'SELECT';
SELECT cron.schedule('rollup-engagement-daily', '20 0 * * *',
  $c$SELECT public.rollup_engagement_daily(date_trunc('day', now())::date - interval '1 day');$c$);

-- the HTTP jobs, literal credentials (pre-P9-c shape)
SELECT cron.schedule(j.job, j.sched, format(
  'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',%L,''x-cron-secret'',%L), body := ''{}''::jsonb)',
  'https://fixture-not-a-project.supabase.co/functions/v1/' || j.job, 'Bearer ' || :'old_key', :'old_cs'))
  FROM (VALUES ('apply-scheduled-boosts', '*/5 * * * *', 1), ('autoscale-ad-traffic', '0 */6 * * *', 0),
               ('expire-gift-credits', '15 0 * * *', 1), ('judging-invariants-nightly', '0 2 * * *', 1),
               ('send-reengagement-emails', '0 9 * * *', 0), ('backup-reminder', '0 8 * * 1', 0)) j(job, sched, on_staging)
 WHERE :'shape' = 'production' OR j.on_staging = 1;

-- P5-b reads its own secret inline (production's shape); a separate secret, not rotated here.
SELECT vault.create_secret(:'sp_secret', 'SCHEDULED_POSTS_CRON_SECRET', 'fixture');
SELECT cron.alter_job(jobid, active := false) FROM cron.job;
