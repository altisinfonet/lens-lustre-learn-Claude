-- ═══════════════════════════════════════════════════════════════════════════
-- P5 · 20261004_0002 — the post-jobs worker: once a minute, idle back-off, drain
-- Phase 3 unit P5 (D1, T1). Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (GATE_REGISTER P5): "no scheduled job runs more often than once a minute
-- unless it is demonstrably saturated; queue workers are woken by an event; idle
-- back-off is implemented and its effect measured." R-82 replaces the traffic
-- reading with a synthetic test (docs/evidence/d1/P5/).
--
-- WHAT IS THERE TODAY (staging, read-only, 2026-10-04 08:07 UTC):
--   cron job 'process-post-jobs', schedule '5 seconds', command
--   "SELECT public.process_post_jobs(100);" — 17,280 runs a day whatever the
--   load. It is not in git (created outside a migration). On staging the queue
--   'post_jobs' does not even exist, and all 122,591 runs since 2026-09-27
--   FAILED ("job startup timeout"): a 5-second schedule that cannot start its
--   own worker in time. They are 90 % of cron.job_run_details (P6).
--
-- WHAT THIS FILE DOES
--   1. public.drain_post_jobs(_batch, _budget): the worker the cron job now calls.
--      · IDLE BACK-OFF. If the queue does not exist, or no message is visible
--        (one probe of pgmq's vt index), it returns {"idle": true} at once and
--        process_post_jobs is not called.
--      · DRAIN. Otherwise it calls process_post_jobs(_batch) repeatedly until a
--        batch comes back short (the queue is empty) or _budget is spent, so one
--        run clears a burst instead of one batch per tick. Under load a minute's
--        run does more work than twelve 5-second runs did.
--      process_post_jobs itself is UNCHANGED (its handlers, visibility timeout and
--      poison-message rule are the same).
--   2. Reschedules 'process-post-jobs' to '* * * * *' (once a minute) with the
--      new command. The previous schedule and command are saved first in
--      public.p5_cron_previous, so the rollback restores them exactly, whatever
--      they were on that lane.
--
-- WHAT IT DOES NOT DO — stated, not hidden:
--   · "Woken by an event" (gate clause 2) is NOT met by this file. A database
--     cannot start a worker on commit without an outside caller; that needs an
--     edge-function worker woken by pg_net from the enqueue, which carries a
--     secret (P9). Recorded as P5-b for the Auditor; this file is P5-a.
--   · Notification latency for tags, reactions and comments becomes up to 60 s
--     (was up to 5 s, on production). That is the cost of clause 1 until P5-b.
--   · The production-only 'process-email-queue' job (5 s, not in git) is not
--     touched: its command is not in git and auth e-mails must not wait 60 s.
--     PROBE_p5_cron_cadence.sql names it on production; it goes with P5-b.
--
-- OBJECTS (reservation): new public.drain_post_jobs(int, interval); new
-- public.p5_cron_previous; cron job 'process-post-jobs' (schedule + command).
-- BLOCK: 20261004_* (today's block; 0001 is P1-H per MASTER R-82). The Auditor
-- confirms or re-numbers.
-- NOT RE-RUNNABLE: PRE-002 refuses once the job already calls drain_post_jobs.
-- ROLLBACK: supabase/rollback/20261004_0002_p5_post_jobs_idle_backoff_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_p5_cron_cadence.sql
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

DO $preconditions$
DECLARE
  j record;
BEGIN
  -- PRE-001 · pg_cron and the function the job calls exist.
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('public.process_post_jobs(integer)') IS NULL THEN
    RAISE EXCEPTION 'P5-0002-PRE-001: cron schema or public.process_post_jobs(integer) is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · exactly one job named process-post-jobs, still calling process_post_jobs directly.
  SELECT count(*) AS n, max(command) AS command INTO j FROM cron.job WHERE jobname = 'process-post-jobs';
  IF j.n <> 1 OR j.command !~* 'process_post_jobs\s*\(' OR j.command ~* 'drain_post_jobs' THEN
    RAISE EXCEPTION 'P5-0002-PRE-002: expected one job process-post-jobs calling process_post_jobs(); found % job(s), command %',
      j.n, coalesce(j.command, '(none)')
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the previous schedule, kept for an exact rollback ──────────────────
CREATE TABLE IF NOT EXISTS public.p5_cron_previous (
  jobname   text PRIMARY KEY,
  schedule  text NOT NULL,
  command   text NOT NULL,
  saved_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.p5_cron_previous ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.p5_cron_previous FROM PUBLIC;
REVOKE ALL ON public.p5_cron_previous FROM anon;
REVOKE ALL ON public.p5_cron_previous FROM authenticated;
INSERT INTO public.p5_cron_previous (jobname, schedule, command)
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'process-post-jobs'
ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command, saved_at = now();

-- ── 2. the worker: idle back-off + drain ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.drain_post_jobs(_batch integer DEFAULT 100,
                                                  _budget interval DEFAULT interval '20 seconds')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $fn$
DECLARE
  _t0     timestamptz := clock_timestamp();
  _r      jsonb;
  _n      int;
  _runs   int := 0;
  _ok     int := 0;
  _failed int := 0;
  _arch   int := 0;
  _ready  boolean;
BEGIN
  -- Idle back-off, step 1: no queue at all (staging today) → nothing to do.
  IF to_regclass('pgmq.q_post_jobs') IS NULL THEN
    RETURN jsonb_build_object('idle', true, 'reason', 'queue post_jobs does not exist', 'ran_at', _t0);
  END IF;
  -- Idle back-off, step 2: nothing visible → one index probe, then return.
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM pgmq.q_post_jobs WHERE vt <= clock_timestamp())' INTO _ready;
  IF NOT _ready THEN
    RETURN jsonb_build_object('idle', true, 'ran_at', _t0);
  END IF;
  -- Drain: batches until one comes back short or the budget is spent.
  LOOP
    _r := public.process_post_jobs(_batch);
    _runs := _runs + 1;
    _n := coalesce((_r->>'processed')::int, 0) + coalesce((_r->>'failed')::int, 0) + coalesce((_r->>'archived')::int, 0);
    _ok := _ok + coalesce((_r->>'processed')::int, 0);
    _failed := _failed + coalesce((_r->>'failed')::int, 0);
    _arch := _arch + coalesce((_r->>'archived')::int, 0);
    EXIT WHEN _n < _batch OR clock_timestamp() - _t0 >= _budget;
  END LOOP;
  RETURN jsonb_build_object('idle', false, 'batches', _runs, 'processed', _ok, 'failed', _failed,
                            'archived', _arch, 'ms', round(extract(epoch FROM clock_timestamp() - _t0) * 1000),
                            'ran_at', _t0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.drain_post_jobs(integer, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.drain_post_jobs(integer, interval) FROM anon;
REVOKE ALL ON FUNCTION public.drain_post_jobs(integer, interval) FROM authenticated;

-- ── 3. once a minute (cron.schedule with an existing name updates that job) ─
SELECT cron.schedule('process-post-jobs', '* * * * *',
                     $cmd$SELECT public.drain_post_jobs(100, interval '20 seconds');$cmd$);

DO $postconditions$
DECLARE
  j record;
BEGIN
  SELECT count(*) AS n, max(schedule) AS schedule, max(command) AS command INTO j
    FROM cron.job WHERE jobname = 'process-post-jobs';
  IF j.n <> 1 OR j.schedule <> '* * * * *' OR j.command !~* 'drain_post_jobs' THEN
    RAISE EXCEPTION 'P5-0002-POST-001: process-post-jobs is (% job(s), %, %), not once a minute calling drain_post_jobs',
      j.n, j.schedule, j.command USING ERRCODE = 'raise_exception';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p5_cron_previous WHERE jobname = 'process-post-jobs') THEN
    RAISE EXCEPTION 'P5-0002-POST-002: the previous schedule was not saved' USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.drain_post_jobs(integer, interval)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.drain_post_jobs(integer, interval)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.p5_cron_previous', 'SELECT')
     OR has_table_privilege('authenticated', 'public.p5_cron_previous', 'SELECT') THEN
    RAISE EXCEPTION 'P5-0002-POST-003: drain_post_jobs or p5_cron_previous is reachable by an API role'
      USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P5-0002: process-post-jobs runs once a minute with idle back-off and drain';
END
$postconditions$;

COMMIT;
