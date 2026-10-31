-- P9-c fixture — SCRATCH ONLY (database p5cron = cron.database_name; real pg_cron 1.6).
-- vault and pg_net are STUBS with their real signatures (pg_net 0.20.4 http_post;
-- vault.create_secret / decrypted_secrets; vault._decrypt counts reads). The six
-- jobs have PRODUCTION's shape (Owner's read 2026-10-04) and schedules, with
-- INVENTED urls and credentials: nothing here is a real key. One non-HTTP job
-- (rollup-engagement-daily, its command shape as on staging) has short literals,
-- to show the PROBE does not mistake the span between two literals for one.
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

CREATE FUNCTION public.rollup_engagement_daily(date) RETURNS void LANGUAGE sql AS 'SELECT';
DO $jobs$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('apply-scheduled-boosts',     '*/5 * * * *', 'apply-scheduled-boosts'),
      ('autoscale-ad-traffic',       '0 */6 * * *', 'autoscale-ad-traffic'),
      ('expire-gift-credits',        '15 0 * * *',  'expire-gift-credits'),
      ('judging-invariants-nightly', '0 2 * * *',   'judging-invariants-nightly'),
      ('send-reengagement-emails',   '0 9 * * *',   'send-reengagement-emails'),
      ('backup-reminder',            '0 8 * * 1',   'backup-reminder')) v(job, sched, fn)
  LOOP
    PERFORM cron.schedule(r.job, r.sched, format($c$
 select net.http_post(
 url := %L,
 headers := jsonb_build_object(
 'Content-Type','application/json',
 'Authorization','Bearer FIXTURE-NOT-A-SECRET-%s',
 'x-cron-secret','fixture-not-a-secret-%s'),
 body := '{}'::jsonb) $c$, 'https://fixture-not-a-project.supabase.co/functions/v1/' || r.fn, md5(r.job), md5(r.fn || 'x')));
  END LOOP;
END
$jobs$;
SELECT cron.schedule('rollup-engagement-daily', '20 0 * * *', $c$
 SELECT public.rollup_engagement_daily(((now() AT TIME ZONE 'UTC') - interval '1 day')::date);
 $c$);
SELECT cron.alter_job(jobid, active := false) FROM cron.job;
