-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P9 → P5-b · the e-mail queue (20261004_0006) — the LIVE half.
-- READ-ONLY. Ends in ROLLBACK. Raises (and so fails the dispatch) on a hit.
--
-- E1 · cron job 'process-email-queue', where it exists, runs at most once a
--      minute, calls public.email_queue_tick() and carries no net.http_post and
--      no quoted literal of 17+ characters (no secret in the command, F-P6-1);
--      its HTTP target is in vault ('p9_cron_http:process-email-queue').
-- E2 · every e-mail queue table that exists (pgmq.q_auth_emails,
--      pgmq.q_transactional_emails) has the enabled statement trigger
--      p9_email_wake — a queue created later without it is a hit.
-- E3 · public.delete_email refuses a queue outside the allow-list (A-P9-3).
-- E4 · the wake machinery exists and no API role can execute it.
-- E5 · SEC-P9-1: an enqueue only TRIES the wake lock (never waits on another).
-- OPEN, not judged here (P9-c): any OTHER cron job whose command still calls
-- net.http_post or holds a long literal is listed by name in the PASS notice.
-- Commands are never printed: they may carry secrets.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  j     record;
  _q    text;
  hits  text := '';
  open_ text;
  st    record;
BEGIN
  IF to_regprocedure('public.email_queue_wake(text)') IS NULL OR to_regprocedure('public.email_queue_tick()') IS NULL
     OR to_regprocedure('public.email_queue_wake_trg()') IS NULL OR to_regclass('public.email_queue_wake_state') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P9-email: E4 the wake machinery of 20261004_0006 is not installed';
  END IF;
  -- E1
  FOR j IN SELECT schedule, command FROM cron.job WHERE jobname = 'process-email-queue' LOOP
    IF j.schedule ~* '^\s*\d+\s+seconds?\s*$' THEN hits := hits || E'\n  E1 schedule is sub-minute (' || j.schedule || ')'; END IF;
    IF j.command ~* 'http_post' THEN hits := hits || E'\n  E1 the command still calls net.http_post'; END IF;
    IF j.command ~ '''[^'']{17,}''' THEN hits := hits || E'\n  E1 the command holds a long quoted literal'; END IF;
    IF j.command !~* 'public\.email_queue_tick\(\)' THEN hits := hits || E'\n  E1 the command does not call public.email_queue_tick()'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'p9_cron_http:process-email-queue') THEN
      hits := hits || E'\n  E1 no vault target p9_cron_http:process-email-queue'; END IF;
  END LOOP;
  -- E2
  FOREACH _q IN ARRAY ARRAY['q_auth_emails', 'q_transactional_emails'] LOOP
    -- F-AUD-2: nested IF + to_regclass(); a ::regclass cast raises for an absent queue.
    IF to_regclass('pgmq.' || _q) IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('pgmq.' || _q)
                        AND tgname = 'p9_email_wake' AND tgenabled = 'O') THEN
        hits := hits || E'\n  E2 pgmq.' || _q || ' has no enabled p9_email_wake trigger';
      END IF;
    END IF;
  END LOOP;
  -- E3
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.delete_email(text,bigint)'::regprocedure)
     !~ 'NOT IN \(''transactional_emails'', ''auth_emails''\)' THEN
    hits := hits || E'\n  E3 delete_email has no queue allow-list';
  END IF;
  -- E5
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.email_queue_wake(text)'::regprocedure)
     !~ 'pg_try_advisory_xact_lock' THEN
    hits := hits || E'\n  E5 email_queue_wake makes an enqueue wait on the lock (no try-lock, SEC-P9-1)';
  END IF;
  -- E4
  IF has_function_privilege('anon', 'public.email_queue_wake(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.email_queue_wake(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.email_queue_tick()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.email_queue_tick()', 'EXECUTE') THEN
    hits := hits || E'\n  E4 an API role can execute the wake';
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL P9-email:%', hits;
  END IF;
  SELECT string_agg(jobname, ', ' ORDER BY jobname) INTO open_ FROM cron.job
   WHERE jobname <> 'process-email-queue' AND (command ~* 'http_post' OR command ~ '''[^'']{17,}''');
  SELECT wakes, idle_ticks, last_wake_at INTO st FROM public.email_queue_wake_state;
  RAISE NOTICE 'PROBE PASS P9-email: job %, wakes %, idle ticks %, last wake %. OPEN (P9-c, not this unit): %',
    CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue') THEN 'once a minute → email_queue_tick()' ELSE 'absent on this lane' END,
    st.wakes, st.idle_ticks, coalesce(st.last_wake_at::text, 'never'), coalesce(open_, 'none');
END
$probe$;
ROLLBACK;
