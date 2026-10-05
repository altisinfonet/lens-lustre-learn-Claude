-- ═══════════════════════════════════════════════════════════════════════════
-- P5-b · 20261004_0007 — publish-scheduled-posts calls its edge function only
-- when a post is due; no secret and no vault read in the cron command.
-- Phase 3 units P5 (clause 3, idle back-off) + P9 (D1, T1). Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IS THERE TODAY
--   production (the Owner's read, 2026-10-04 ~15:10 UTC, A-P9-2): job
--     'publish-scheduled-posts', '* * * * *', "select net.http_post(url := '<edge
--     fn>', headers := {…, the secret read from vault.decrypted_secrets INLINE},
--     …)" — 1,440 HTTP calls and 1,440 vault decrypts a day, whether or not one
--     post is scheduled. The inline decrypt is the statement P9's gate names.
--   staging (read-only, 2026-10-04): the same job, with the header values as
--     LITERALS in the command; scheduled_posts holds 0 rows.
--   Neither is in git.
--
-- WHAT THIS FILE DOES
--   1. public.scheduled_posts_due(): true only when the edge function has
--      something to do — exactly its two selections
--      (supabase/functions/publish-scheduled-posts/index.ts):
--        · a 'pending' row with scheduled_for <= now()   (the claim, step 2)
--        · a 'publishing' row not updated for 5 minutes   (the self-heal reclaim)
--      Two index probes: idx_scheduled_posts_pending_due (exists) and
--      idx_scheduled_posts_publishing_stale (new, partial, empty in normal use).
--   2. public.publish_scheduled_posts_tick(): not due → returns 'idle' — no HTTP
--      call, no vault read. Due → reads the target from vault and makes the one
--      call the job made before.
--   3. MOVES THE HTTP TARGET OUT OF THE COMMAND, INSIDE THE DATABASE — the same
--      capture as 20261004_0006: the job's own net.http_post(...) arguments
--      (including, on production, the inline vault read) are evaluated once into
--      vault secret 'p9_cron_http:publish-scheduled-posts'; the previous schedule
--      and command go to 'p9_cron_previous:publish-scheduled-posts' for an exact
--      rollback. No person and no file sees them.
--   4. The job stays '* * * * *' (once a minute is within P5 clause 1) and now
--      runs "SELECT public.publish_scheduled_posts_tick();".
--
-- LATENCY: unchanged — a due post is published on the next minute, as before.
-- ROTATION, STATED: on production the header was read from the vault on every
-- run. After 0007 the evaluated header is held in 'p9_cron_http:…'; rotating
-- SCHEDULED_POSTS_CRON_SECRET now means updating that one vault secret
-- (docs/evidence/d1/P5b/README.md gives the statement).
-- WHAT IT DOES NOT DO: the edge function is unchanged; the job is not woken by
-- an event because a scheduled post becomes due by the clock, not by a write.
--
-- OBJECTS (reservation): new public.publish_scheduled_posts_tick_state,
-- public.scheduled_posts_due(), public.publish_scheduled_posts_tick(); index
-- idx_scheduled_posts_publishing_stale; vault secrets
-- p9_cron_http:publish-scheduled-posts, p9_cron_previous:publish-scheduled-posts;
-- cron job 'publish-scheduled-posts' (command).
-- NOT RE-RUNNABLE: PRE-003 refuses once the tick exists.
-- ROLLBACK: supabase/rollback/20261004_0007_p5b_scheduled_posts_due_only_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_p5b_scheduled_posts_tick.sql
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
  IF to_regnamespace('cron') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regclass('public.scheduled_posts') IS NULL THEN
    RAISE EXCEPTION 'P5b-0007-PRE-001: cron, net.http_post, vault or public.scheduled_posts is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · at most one publish-scheduled-posts job, and if present it is
  -- exactly one "select net.http_post(...)" — the shape the capture can evaluate.
  SELECT count(*) AS n, max(command) AS command INTO j FROM cron.job WHERE jobname = 'publish-scheduled-posts';
  IF j.n > 1 OR (j.n = 1 AND (
       j.command !~* '^\s*select\s+net\.http_post\s*\('
    OR (SELECT count(*) FROM regexp_matches(j.command, 'http_post', 'gi')) <> 1
    OR rtrim(j.command, E' \t\r\n;') ~ ';')) THEN
    -- the command itself is not printed: it may carry secrets.
    RAISE EXCEPTION 'P5b-0007-PRE-002: % publish-scheduled-posts job(s); expected 0 or 1 whose command is a single "select net.http_post(...)"', j.n
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · not applied already; the vault names are free.
  IF to_regprocedure('public.publish_scheduled_posts_tick()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name IN ('p9_cron_http:publish-scheduled-posts', 'p9_cron_previous:publish-scheduled-posts')) THEN
    RAISE EXCEPTION 'P5b-0007-PRE-003: 20261004_0007 is already applied (the tick or its vault secrets exist)'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-004 · the columns the due-check reads.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scheduled_posts'
        AND column_name IN ('status', 'scheduled_for', 'updated_at')) <> 3 THEN
    RAISE EXCEPTION 'P5b-0007-PRE-004: public.scheduled_posts lacks status, scheduled_for or updated_at'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. state: one row; the counters are the measurement ────────────────────
CREATE TABLE public.publish_scheduled_posts_tick_state (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_wake_at  timestamptz,
  wakes         bigint NOT NULL DEFAULT 0,
  idle_ticks    bigint NOT NULL DEFAULT 0,
  applied_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.publish_scheduled_posts_tick_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.publish_scheduled_posts_tick_state FROM PUBLIC;
REVOKE ALL ON public.publish_scheduled_posts_tick_state FROM anon;
REVOKE ALL ON public.publish_scheduled_posts_tick_state FROM authenticated;
INSERT INTO public.publish_scheduled_posts_tick_state DEFAULT VALUES;

-- ── 2. is a post due? (the edge function's own two selections) ─────────────
-- P28: partial, rows in 'publishing' only (empty in normal use); serves the stale-reclaim probe below; reviewed by D1 2026-10-04.
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_publishing_stale
  ON public.scheduled_posts (updated_at) WHERE status = 'publishing';

CREATE FUNCTION public.scheduled_posts_due()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.scheduled_posts
                  WHERE status = 'pending' AND scheduled_for <= clock_timestamp())
      OR EXISTS (SELECT 1 FROM public.scheduled_posts
                  WHERE status = 'publishing' AND updated_at < clock_timestamp() - interval '5 minutes');
$fn$;

-- ── 3. the tick: due? → vault → the one HTTP call ───────────────────────────
CREATE FUNCTION public.publish_scheduled_posts_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _t jsonb;
BEGIN
  IF NOT public.scheduled_posts_due() THEN
    UPDATE public.publish_scheduled_posts_tick_state SET idle_ticks = idle_ticks + 1;
    RETURN 'idle';
  END IF;
  SELECT decrypted_secret::jsonb INTO _t FROM vault.decrypted_secrets
   WHERE name = 'p9_cron_http:publish-scheduled-posts';
  IF _t IS NULL THEN
    RETURN 'no target';
  END IF;
  PERFORM net.http_post(url := _t->>'url', body := coalesce(_t->'body', '{}'::jsonb),
                        params := coalesce(_t->'params', '{}'::jsonb), headers := _t->'headers',
                        timeout_milliseconds := coalesce((_t->>'timeout_milliseconds')::int, 5000));
  UPDATE public.publish_scheduled_posts_tick_state SET last_wake_at = clock_timestamp(), wakes = wakes + 1;
  RETURN 'woken';
END;
$fn$;

REVOKE ALL ON FUNCTION public.scheduled_posts_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_scheduled_posts_tick() FROM PUBLIC, anon, authenticated;

-- ── 4. the job: target into vault, then the tick ───────────────────────────
DO $move$
DECLARE
  j  record;
  _t jsonb;
BEGIN
  SELECT schedule, command INTO j FROM cron.job WHERE jobname = 'publish-scheduled-posts';
  IF NOT FOUND THEN
    RAISE NOTICE 'P5b-0007: no publish-scheduled-posts job on this lane — none created (the tick answers "no target")';
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
  IF _t->>'url' IS NULL OR _t->>'url' !~ '/functions/v1/publish-scheduled-posts' THEN
    RAISE EXCEPTION 'P5b-0007-MOVE-001: the captured url is not the publish-scheduled-posts edge function'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(_t->'headers', '{}'::jsonb)) h WHERE h.value = 'null'::jsonb) THEN
    RAISE EXCEPTION 'P5b-0007-MOVE-002: a captured header is NULL (its vault secret is missing on this lane) — refusing to store a broken target'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM vault.create_secret(_t::text, 'p9_cron_http:publish-scheduled-posts',
          'P9/P5-b · 20261004_0007 · HTTP target of cron job publish-scheduled-posts (moved out of the command)');
  PERFORM vault.create_secret(jsonb_build_object('schedule', j.schedule, 'command', j.command)::text,
          'p9_cron_previous:publish-scheduled-posts',
          'P9/P5-b · 20261004_0007 · the job before 0007, for the rollback only');
  PERFORM cron.schedule('publish-scheduled-posts', '* * * * *', 'SELECT public.publish_scheduled_posts_tick();');
  DROP FUNCTION pg_temp.p9_capture(text, jsonb, jsonb, jsonb, integer);
END
$move$;

DO $postconditions$
DECLARE
  j record;
BEGIN
  SELECT count(*) AS n, max(schedule) AS schedule, max(command) AS command INTO j
    FROM cron.job WHERE jobname = 'publish-scheduled-posts';
  IF j.n = 1 AND (j.schedule <> '* * * * *' OR j.command <> 'SELECT public.publish_scheduled_posts_tick();'
                  OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'p9_cron_http:publish-scheduled-posts')
                  OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'p9_cron_previous:publish-scheduled-posts')) THEN
    RAISE EXCEPTION 'P5b-0007-POST-001: publish-scheduled-posts is not once a minute calling the tick with its target in vault'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.publish_scheduled_posts_tick()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.publish_scheduled_posts_tick()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.scheduled_posts_due()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.scheduled_posts_due()', 'EXECUTE')
     OR has_table_privilege('anon', 'public.publish_scheduled_posts_tick_state', 'SELECT')
     OR has_table_privilege('authenticated', 'public.publish_scheduled_posts_tick_state', 'SELECT') THEN
    RAISE EXCEPTION 'P5b-0007-POST-002: a new function or the state table is reachable by an API role' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P5b-0007: publish-scheduled-posts calls HTTP only when a post is due; target in vault';
END
$postconditions$;

COMMIT;
