-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S9 · what can a seeded post set off? (Owner item 20, condition 1:
-- "re-measure first that staging sends nothing to members' phones / e-mail").
-- READ ONLY, ROLLBACK, lane-asserted. Never fails on findings. Prints object
-- names, flags and counts only — never row data, tokens or e-mails.
--
--   T  every user trigger on public.posts and public.user_notifications
--      (and on any table those trigger functions insert into, one level),
--      with flags for what its function body does: pg_net / http, a
--      functions/v1 URL, push, e-mail, pgmq.send, realtime broadcast
--   W  database webhooks (triggers calling supabase_functions.http_request)
--      on those tables
--   J  cron jobs whose command names push, notification, email, post_jobs,
--      functions/v1 or net.http (job name, schedule, active, flags)
--   Q  every pgmq queue and its current depth
--   H  the post-jobs worker: every pj_handle_* / process_post_jobs function,
--      with the same flags
--   D  devices that could receive a push: rows in public tables named like
--      *device* / *push* with a non-null token-like column (count only)
--   P  whether posts / user_notifications are in a realtime publication
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $probe$
DECLARE
  r record; n bigint; c text; flags text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  RAISE NOTICE 'S9S|lane=%|at=%', current_setting('p32.lane'), date_trunc('second', now());

  -- T + W: triggers on posts / user_notifications
  FOR r IN SELECT t.tgrelid::regclass::text AS tbl, t.tgname, t.tgenabled, p.oid::regprocedure::text AS fn, p.prosrc,
                  pg_get_triggerdef(t.oid) AS def
             FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE NOT t.tgisinternal
              AND t.tgrelid IN ('public.posts'::regclass, 'public.user_notifications'::regclass)
            ORDER BY 1, 2 LOOP
    flags := concat_ws(',',
      CASE WHEN r.prosrc ~* '(net\.http|pg_net|http_post|http_get|extensions\.http)' THEN 'HTTP' END,
      CASE WHEN r.prosrc ~* 'functions/v1' THEN 'EDGE_URL' END,
      CASE WHEN r.prosrc ~* 'push' THEN 'push' END,
      CASE WHEN r.prosrc ~* '(e-?mail|smtp|resend)' THEN 'email' END,
      CASE WHEN r.prosrc ~* 'pgmq\.send|enqueue' THEN 'queue' END,
      CASE WHEN r.prosrc ~* 'realtime\.(send|broadcast)' THEN 'broadcast' END,
      CASE WHEN r.fn LIKE 'supabase_functions.http_request%' THEN 'DB_WEBHOOK' END);
    RAISE NOTICE 'S9S|T|%|%|enabled=%|fn=%|flags=%', r.tbl, r.tgname, r.tgenabled, r.fn, coalesce(nullif(flags, ''), '-');
  END LOOP;

  -- T (one level down): triggers on tables the user_notifications/posts trigger functions insert into
  FOR r IN WITH fns AS (
             SELECT p.prosrc FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.posts'::regclass, 'public.user_notifications'::regclass)),
           targets AS (
             SELECT DISTINCT lower(m[1]) AS tname
               FROM fns, regexp_matches(fns.prosrc, 'insert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)', 'gi') m)
           SELECT t.tgrelid::regclass::text AS tbl, t.tgname, t.tgenabled, p.oid::regprocedure::text AS fn, p.prosrc
             FROM targets x JOIN pg_class c ON c.relname = x.tname JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
             JOIN pg_trigger t ON t.tgrelid = c.oid AND NOT t.tgisinternal JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE c.oid NOT IN ('public.posts'::regclass, 'public.user_notifications'::regclass)
            ORDER BY 1, 2 LOOP
    flags := concat_ws(',',
      CASE WHEN r.prosrc ~* '(net\.http|pg_net|http_post|http_get|extensions\.http)' THEN 'HTTP' END,
      CASE WHEN r.prosrc ~* 'functions/v1' THEN 'EDGE_URL' END,
      CASE WHEN r.prosrc ~* 'push' THEN 'push' END,
      CASE WHEN r.prosrc ~* '(e-?mail|smtp|resend)' THEN 'email' END,
      CASE WHEN r.prosrc ~* 'pgmq\.send|enqueue' THEN 'queue' END,
      CASE WHEN r.fn LIKE 'supabase_functions.http_request%' THEN 'DB_WEBHOOK' END);
    RAISE NOTICE 'S9S|T2|%|%|enabled=%|fn=%|flags=%', r.tbl, r.tgname, r.tgenabled, r.fn, coalesce(nullif(flags, ''), '-');
  END LOOP;

  -- J: cron jobs
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN EXECUTE $q$SELECT jobname, schedule, active, command FROM cron.job
                        WHERE command ~* '(push|notif|e-?mail|post_jobs|functions/v1|net\.http)' ORDER BY jobname$q$ LOOP
      flags := concat_ws(',',
        CASE WHEN r.command ~* '(net\.http|functions/v1)' THEN 'HTTP' END,
        CASE WHEN r.command ~* 'push' THEN 'push' END,
        CASE WHEN r.command ~* 'e-?mail' THEN 'email' END,
        CASE WHEN r.command ~* 'post_jobs' THEN 'post_jobs' END,
        CASE WHEN r.command ~* 'notif' THEN 'notif' END);
      RAISE NOTICE 'S9S|J|%|%|active=%|flags=%', r.jobname, r.schedule, r.active, flags;
    END LOOP;
  END IF;

  -- Q: pgmq queues
  IF to_regclass('pgmq.meta') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT queue_name FROM pgmq.meta ORDER BY 1' LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM pgmq.%I', 'q_' || r.queue_name) INTO n;
        RAISE NOTICE 'S9S|Q|%|depth=%', r.queue_name, n;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'S9S|Q|%|unreadable (SQLSTATE %)', r.queue_name, SQLSTATE;
      END;
    END LOOP;
  ELSE
    RAISE NOTICE 'S9S|Q|pgmq not installed';
  END IF;

  -- H: post-jobs worker functions
  FOR r IN SELECT p.oid::regprocedure::text AS fn, p.prosrc FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND (p.proname ~ '^pj_handle_' OR p.proname IN ('process_post_jobs', 'drain_post_jobs', 'fan_out_new_post', 'enqueue_post_job', 'enqueue_post_created_job'))
            ORDER BY 1 LOOP
    flags := concat_ws(',',
      CASE WHEN r.prosrc ~* '(net\.http|pg_net|http_post|http_get|extensions\.http)' THEN 'HTTP' END,
      CASE WHEN r.prosrc ~* 'functions/v1' THEN 'EDGE_URL' END,
      CASE WHEN r.prosrc ~* 'push' THEN 'push' END,
      CASE WHEN r.prosrc ~* '(e-?mail|smtp|resend)' THEN 'email' END,
      CASE WHEN r.prosrc ~* 'insert\s+into\s+(public\.)?user_notifications' THEN 'writes_notifications' END,
      CASE WHEN r.prosrc ~* 'post_created' THEN 'handles_post_created' END);
    RAISE NOTICE 'S9S|H|%|flags=%', r.fn, coalesce(nullif(flags, ''), '-');
  END LOOP;

  -- D: devices that could receive a push
  FOR r IN SELECT c.oid::regclass AS rel, c.relname, a.attname
             FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname ~* '(device|push)'
              AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~* '(token|endpoint|subscription)'
            ORDER BY 2, 3 LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I IS NOT NULL', r.rel, r.attname) INTO n;
      RAISE NOTICE 'S9S|D|%.%|non_null=%', r.relname, r.attname, n;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'S9S|D|%.%|unreadable (SQLSTATE %)', r.relname, r.attname, SQLSTATE;
    END;
  END LOOP;

  -- P: realtime publications
  FOR r IN SELECT pubname, schemaname || '.' || tablename AS t FROM pg_publication_tables
            WHERE schemaname = 'public' AND tablename IN ('posts', 'user_notifications') ORDER BY 1, 2 LOOP
    RAISE NOTICE 'S9S|P|%|%', r.pubname, r.t;
  END LOOP;
  RAISE NOTICE 'S9S|done';
END
$probe$;

ROLLBACK;
