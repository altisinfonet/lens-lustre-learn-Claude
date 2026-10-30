-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation audit 0903 · switches, monitoring flow, cron health,
-- data-safety constraints, scale counts. READ ONLY, ROLLBACK.
-- Prints COUNTS and constraint DEFINITIONS only — never member rows, e-mails
-- or ids. site_settings: key plus the value only when it is a short boolean or
-- on-off literal; any other value is shown as its LENGTH.
-- Changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;

\pset pager off
\pset format unaligned
\pset fieldsep '|'

SELECT 'AUDIT0903_LANE', current_setting('p32.lane'), now();

-- feature switches
DO $s$
DECLARE r record;
BEGIN
  IF to_regclass('public.feature_access') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT fa.feature, fa.mode::text m,
        (SELECT count(*) FROM public.feature_access_members x WHERE x.feature = fa.feature) n
        FROM public.feature_access fa ORDER BY 1' LOOP
      RAISE NOTICE 'SWITCH|%|%|selected=%', r.feature, r.m, r.n;
    END LOOP;
  END IF;
  IF to_regclass('public.site_settings') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT key, value::text v FROM public.site_settings ORDER BY key' LOOP
      IF r.v ~* '^"?(true|false|on|off|everyone|selected|null)"?$' THEN
        RAISE NOTICE 'SETTING|%|%', r.key, r.v;
      ELSE
        RAISE NOTICE 'SETTING|%|len=%', r.key, length(r.v);
      END IF;
    END LOOP;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BLOCK_ERROR|%|%', 'blk_s', SQLSTATE;
END $s$;

-- monitoring data flow (counts only)
DO $m$
DECLARE n bigint; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_telemetry', 'activity_logs', 'db_audit_logs', 'email_send_log',
                           'notification_emit_log', 'test_agent_runs', 'feed_events', 'admin_notifications'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND EXISTS (
         SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at') THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE created_at > now() - interval ''24 hours''', t) INTO n;
      RAISE NOTICE 'FLOW24H|%|%', t, n;
    ELSE
      RAISE NOTICE 'FLOW24H|%|absent-or-no-created_at', t;
    END IF;
  END LOOP;
  IF to_regclass('public.client_telemetry') IS NOT NULL THEN
    FOR t, n IN EXECUTE 'SELECT kind || '':'' || platform, count(*) FROM public.client_telemetry
                         WHERE created_at > now() - interval ''24 hours'' GROUP BY 1 ORDER BY 1' LOOP
      RAISE NOTICE 'TELEMETRY24H|%|%', t, n;
    END LOOP;
    EXECUTE 'SELECT max(created_at)::text FROM public.client_telemetry' INTO t;
    RAISE NOTICE 'TELEMETRY_LAST|%', t;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BLOCK_ERROR|%|%', 'blk_m', SQLSTATE;
END $m$;

-- cron health over last 24h (job name + status counts; no command text)
DO $c$
DECLARE r record;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN RAISE NOTICE 'CRONRUN none'; RETURN; END IF;
  FOR r IN EXECUTE 'SELECT j.jobname, d.status, count(*) n, max(d.start_time)::text last
                      FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
                     WHERE d.start_time > now() - interval ''24 hours''
                     GROUP BY 1, 2 ORDER BY 1, 2' LOOP
    RAISE NOTICE 'CRONRUN|%|%|%|last=%', r.jobname, r.status, r.n, r.last;
  END LOOP;
  FOR r IN EXECUTE 'SELECT j.jobname FROM cron.job j WHERE j.active AND NOT EXISTS (
                      SELECT 1 FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > now() - interval ''48 hours'')' LOOP
    RAISE NOTICE 'CRON_SILENT48H|%', r.jobname;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BLOCK_ERROR|%|%', 'blk_c', SQLSTATE;
END $c$;

-- edge-function HTTP calls from the DB (pg_net) last 24h by status class
DO $h$
DECLARE r record;
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN RAISE NOTICE 'PGNET none'; RETURN; END IF;
  FOR r IN EXECUTE 'SELECT coalesce((status_code/100)::text || ''xx'', ''err'') k, count(*) n
                      FROM net._http_response WHERE created > now() - interval ''24 hours'' GROUP BY 1 ORDER BY 1' LOOP
    RAISE NOTICE 'PGNET24H|%|%', r.k, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BLOCK_ERROR|%|%', 'blk_h', SQLSTATE;
END $h$;

-- data-safety: unique / check / FK constraints on the critical tables
SELECT 'CONSTRAINT', c.conrelid::regclass, c.conname, c.contype, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
 WHERE c.conrelid::regclass::text IN ('post_reactions', 'post_comments', 'comments', 'posts', 'follows',
         'wallets', 'wallet_transactions', 'wallet_ledger_v2_rows', 'wallet_ledger_idempotency',
         'withdrawal_requests', 'competition_orders', 'competition_entries', 'competition_votes',
         'profiles', 'image_reactions', 'comment_reactions', 'post_comment_reactions', 'post_shares')
   AND c.contype IN ('u', 'p', 'c', 'x')
 ORDER BY 2, 3;
SELECT 'UNIQUE_INDEX', i.indrelid::regclass, ci.relname, pg_get_indexdef(i.indexrelid)
  FROM pg_index i JOIN pg_class ci ON ci.oid = i.indexrelid
 WHERE i.indisunique AND NOT i.indisprimary
   AND i.indrelid::regclass::text IN ('post_reactions', 'post_comments', 'posts', 'wallet_transactions',
         'wallet_ledger_v2_rows', 'wallet_ledger_idempotency', 'withdrawal_requests', 'competition_orders',
         'competition_votes', 'image_reactions', 'post_comment_reactions')
 ORDER BY 2, 3;

-- account deletion path: FKs to auth.users and their ON DELETE action
SELECT 'FK_AUTH_USERS', confdeltype, count(*)
  FROM pg_constraint WHERE contype = 'f' AND confrelid = 'auth.users'::regclass GROUP BY 2 ORDER BY 2;

-- scale: row-count estimates (planner stats, no scans) for the biggest tables
SELECT 'ROWS_EST', c.relname, c.reltuples::bigint, pg_size_pretty(pg_total_relation_size(c.oid))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
 ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15;
SELECT 'AUTH_USERS_EST', reltuples::bigint FROM pg_class WHERE oid = 'auth.users'::regclass;

-- recovery-relevant server settings (values are not secrets)
SELECT 'SETTING_PG', name, setting FROM pg_settings
 WHERE name IN ('archive_mode', 'wal_level', 'server_version', 'max_connections', 'statement_timeout');
DO $a$ BEGIN
  RAISE NOTICE 'ARCHIVE_COMMAND_SET|%', length(coalesce(current_setting('archive_command', true), '')) > 0;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ARCHIVE_COMMAND_SET|unreadable %', SQLSTATE;
END $a$;

SELECT 'AUDIT0903_DONE', now();
ROLLBACK;
