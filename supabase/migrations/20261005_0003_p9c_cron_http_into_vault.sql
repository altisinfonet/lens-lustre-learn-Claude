-- ═══════════════════════════════════════════════════════════════════════════
-- P9-c · 20261005_0003 — the remaining six HTTP cron jobs: target and secrets
-- into vault, out of cron.job and cron.job_run_details. D1, T1.
-- Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IS THERE TODAY
--   production (Owner's read 2026-10-04 ~15:10 UTC), each "select
--   net.http_post(url := '<edge fn>', headers := {Authorization: <service key>,
--   x-cron-secret: <secret>}, body := '{}')" with the values as LITERALS:
--     apply-scheduled-boosts      */5 * * * *
--     autoscale-ad-traffic        0 */6 * * *
--     expire-gift-credits         15 0 * * *
--     judging-invariants-nightly  0 2 * * *
--     send-reengagement-emails    0 9 * * *
--     backup-reminder             0 8 * * 1
--   staging (read-only 2026-10-05): the first three of these, same shape.
--   Every run copies the literals into cron.job_run_details (F-P6-1, SEC-P9-4).
--   None is in git.
--
-- WHAT THIS FILE DOES, per job that exists on the lane (an absent one is
-- skipped with a NOTICE, never created):
--   1. The job's own net.http_post(...) arguments are evaluated ONCE, inside the
--      database, into vault secret 'p9_cron_http:<job>' — the same pg_temp
--      capture as 0006/0007: the command is re-pointed at pg_temp.p9_capture,
--      a function with net.http_post's exact parameters, and EXECUTEd. No person
--      and no file sees a value. The previous schedule + command go to vault
--      'p9_cron_previous:<job>' for a byte-exact rollback.
--   2. The job keeps its SCHEDULE and becomes
--        SELECT public.cron_http_call('<job>');
--      which reads that one vault secret and makes the same call. A missing
--      secret RAISES (the run shows failed) — never a silent skip.
--   Refused, nothing changed: a job whose command is not one
--   "select net.http_post(...)" (PRE-002); a captured url that is not an edge
--   function (MOVE-001); a NULL header, i.e. an inline vault read whose secret
--   is missing on this lane (MOVE-002).
-- These jobs run on a clock, not on work: each run IS a call, so the vault is
-- read once per real HTTP call (the P9 wording ruled in R-95).
--
-- AFTER IT, ON A LANE WHERE 0006 AND 0007 ARE APPLIED: no cron command holds
-- net.http_post, an inline vault read or a credential — PROBE_p9c_cron_http.sql
-- C2 checks every job on the lane, not just these six.
-- ROTATION (SEC-P9-2): rotate x-cron-secret + the service key, then update the
-- 'p9_cron_http:*' secrets — the Owner, never D1.
--
-- OBJECTS (reservation): new public.cron_http_call(text); vault secrets
-- p9_cron_http:<job>, p9_cron_previous:<job> for the six jobs; the six jobs'
-- commands.
-- NOT RE-RUNNABLE: PRE-003 refuses once cron_http_call exists.
-- ROLLBACK: supabase/rollback/20261005_0003_p9c_cron_http_into_vault_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_p9c_cron_http.sql
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
  j    record;
  _bad text := '';
BEGIN
  -- PRE-001 · the machinery.
  IF to_regnamespace('cron') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'P9c-0003-PRE-001: cron, net.http_post or vault is missing' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · each of the six that exists is exactly one "select net.http_post(...)".
  FOR j IN SELECT jobname, command FROM cron.job
            WHERE jobname IN ('apply-scheduled-boosts', 'autoscale-ad-traffic', 'expire-gift-credits',
                              'judging-invariants-nightly', 'send-reengagement-emails', 'backup-reminder') LOOP
    IF j.command !~* '^\s*select\s+net\.http_post\s*\('
       OR (SELECT count(*) FROM regexp_matches(j.command, 'http_post', 'gi')) <> 1
       OR rtrim(j.command, E' \t\r\n;') ~ ';' THEN
      _bad := _bad || ' ' || j.jobname;
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    -- commands are never printed: they carry secrets.
    RAISE EXCEPTION 'P9c-0003-PRE-002: not a single "select net.http_post(...)":%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT count(*) FROM (SELECT jobname FROM cron.job GROUP BY jobname HAVING count(*) > 1) d
       WHERE jobname IN ('apply-scheduled-boosts', 'autoscale-ad-traffic', 'expire-gift-credits',
                         'judging-invariants-nightly', 'send-reengagement-emails', 'backup-reminder')) > 0 THEN
    RAISE EXCEPTION 'P9c-0003-PRE-002: a job name appears twice in cron.job' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · not applied already; the vault names are free.
  IF to_regprocedure('public.cron_http_call(text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name IN (
          'p9_cron_http:apply-scheduled-boosts', 'p9_cron_http:autoscale-ad-traffic', 'p9_cron_http:expire-gift-credits',
          'p9_cron_http:judging-invariants-nightly', 'p9_cron_http:send-reengagement-emails', 'p9_cron_http:backup-reminder',
          'p9_cron_previous:apply-scheduled-boosts', 'p9_cron_previous:autoscale-ad-traffic', 'p9_cron_previous:expire-gift-credits',
          'p9_cron_previous:judging-invariants-nightly', 'p9_cron_previous:send-reengagement-emails', 'p9_cron_previous:backup-reminder')) THEN
    RAISE EXCEPTION 'P9c-0003-PRE-003: cron_http_call or a p9-c vault secret already exists — 20261005_0003 is applied'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the one call path ───────────────────────────────────────────────────
CREATE FUNCTION public.cron_http_call(_job text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _t jsonb;
BEGIN
  IF _job IS NULL OR _job !~ '^[a-z0-9][a-z0-9-]{0,62}$' THEN
    RAISE EXCEPTION 'cron_http_call: % is not a job name', coalesce(_job, '<null>') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT decrypted_secret::jsonb INTO _t FROM vault.decrypted_secrets WHERE name = 'p9_cron_http:' || _job;
  IF _t IS NULL OR _t->>'url' IS NULL THEN
    -- the run shows FAILED: a missing target is never a silent skip.
    RAISE EXCEPTION 'cron_http_call: no vault target p9_cron_http:%', _job USING ERRCODE = 'no_data_found';
  END IF;
  RETURN net.http_post(url := _t->>'url', body := coalesce(_t->'body', '{}'::jsonb),
                       params := coalesce(_t->'params', '{}'::jsonb), headers := _t->'headers',
                       timeout_milliseconds := coalesce((_t->>'timeout_milliseconds')::int, 5000));
END;
$fn$;
REVOKE ALL ON FUNCTION public.cron_http_call(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_http_call(text) FROM anon;
REVOKE ALL ON FUNCTION public.cron_http_call(text) FROM authenticated;

-- ── 2. each job: capture into vault, then the same schedule calling it ──────
DO $move$
DECLARE
  _job text;
  j    record;
  _t   jsonb;
  _n   int := 0;
BEGIN
  -- net.http_post's exact parameter names and defaults (pg_net 0.20.4).
  CREATE FUNCTION pg_temp.p9_capture(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
                                     headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb,
                                     timeout_milliseconds integer DEFAULT 5000)
  RETURNS jsonb LANGUAGE sql AS
  $c$ SELECT jsonb_build_object('url', url, 'body', body, 'params', params, 'headers', headers,
                                'timeout_milliseconds', timeout_milliseconds) $c$;
  FOREACH _job IN ARRAY ARRAY['apply-scheduled-boosts', 'autoscale-ad-traffic', 'expire-gift-credits',
                              'judging-invariants-nightly', 'send-reengagement-emails', 'backup-reminder'] LOOP
    SELECT schedule, command INTO j FROM cron.job WHERE jobname = _job;
    IF NOT FOUND THEN
      RAISE NOTICE 'P9c-0003: no % job on this lane — skipped', _job;
      CONTINUE;
    END IF;
    EXECUTE regexp_replace(rtrim(j.command, E' \t\r\n;'), 'net\.http_post\s*\(', 'pg_temp.p9_capture(', 'i') INTO _t;
    IF _t->>'url' IS NULL OR _t->>'url' !~ '^https://[^/]+/functions/v1/[A-Za-z0-9_-]+' THEN
      RAISE EXCEPTION 'P9c-0003-MOVE-001: the captured url of % is not an edge function', _job USING ERRCODE = 'raise_exception';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(_t->'headers', '{}'::jsonb)) h WHERE h.value = 'null'::jsonb) THEN
      RAISE EXCEPTION 'P9c-0003-MOVE-002: a captured header of % is NULL (its vault secret is missing on this lane)', _job
        USING ERRCODE = 'raise_exception';
    END IF;
    PERFORM vault.create_secret(_t::text, 'p9_cron_http:' || _job,
            'P9-c · 20261005_0003 · HTTP target of cron job ' || _job || ' (moved out of the command)');
    PERFORM vault.create_secret(jsonb_build_object('schedule', j.schedule, 'command', j.command)::text,
            'p9_cron_previous:' || _job, 'P9-c · 20261005_0003 · the job before 0003, for the rollback only');
    PERFORM cron.schedule(_job, j.schedule, format('SELECT public.cron_http_call(%L);', _job));
    _n := _n + 1;
  END LOOP;
  DROP FUNCTION pg_temp.p9_capture(text, jsonb, jsonb, jsonb, integer);
  RAISE NOTICE 'P9c-0003: % job(s) moved', _n;
END
$move$;

DO $postconditions$
DECLARE
  _job text;
  j    record;
  _p   jsonb;
BEGIN
  FOREACH _job IN ARRAY ARRAY['apply-scheduled-boosts', 'autoscale-ad-traffic', 'expire-gift-credits',
                              'judging-invariants-nightly', 'send-reengagement-emails', 'backup-reminder'] LOOP
    SELECT schedule, command INTO j FROM cron.job WHERE jobname = _job;
    IF FOUND THEN
      SELECT decrypted_secret::jsonb INTO _p FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:' || _job;
      IF j.command <> format('SELECT public.cron_http_call(%L);', _job) OR _p IS NULL OR j.schedule <> _p->>'schedule'
         OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'p9_cron_http:' || _job) THEN
        RAISE EXCEPTION 'P9c-0003-POST-001: % is not "SELECT public.cron_http_call(...)" on its old schedule with its target in vault', _job
          USING ERRCODE = 'raise_exception';
      END IF;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.cron_http_call(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cron_http_call(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P9c-0003-POST-002: an API role can execute cron_http_call' USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
