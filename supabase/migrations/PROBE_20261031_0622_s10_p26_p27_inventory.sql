-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 P26 + P27 · inventory before any change (measure first).
-- READ ONLY, ROLLBACK. Never fails on findings. Prints schema metadata,
-- counts, sizes and timestamps only — never row data, ids or e-mails.
--
-- Owner decisions 2026-10-31 08:13 UTC (PR #553): P27 "archive and drop" the
-- three old tables below; P26 "as proposed" (gate sentence in
-- docs/gates/GATE_REGISTER.md: audit triggers limited to money, permissions and
-- deletions; the change stored rather than two full row copies; rows older
-- than a stated window moved out of the live database).
--
--   P27  for each of wallet_ledger_v2_diff_log, v3_mirror_log,
--        wallet_ledger_v2_rows: exists, columns, rows, size, time range,
--        write counters, policies, triggers ON it, FKs to/from it, views that
--        read it, publications, every function whose body names it (and every
--        trigger / cron job that runs those functions), function call counts.
--   P26  db_audit_logs: rows, heap / toast / index size, time range, age
--        buckets; rows and stored bytes per (table_name, operation); every
--        trigger whose function writes db_audit_logs; every other function
--        that names it; cron jobs that name it.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $probe$
DECLARE
  t text; r record; ln text; n bigint; tcol text;
  tabs constant text[] := ARRAY['wallet_ledger_v2_diff_log', 'v3_mirror_log', 'wallet_ledger_v2_rows'];
  fnames text[];
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  RAISE NOTICE 'P0622|lane=%|at=%', current_setting('p32.lane'), date_trunc('second', now());

  -- ── P27 ────────────────────────────────────────────────────────────────
  FOREACH t IN ARRAY tabs LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'P27|%|exists=no', t;
      CONTINUE;
    END IF;

    SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
      INTO ln FROM pg_attribute a
     WHERE a.attrelid = ('public.' || t)::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    RAISE NOTICE 'P27|%|columns|%', t, ln;

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    SELECT format('rows=%s total=%s heap=%s | ins=%s upd=%s del=%s live=%s | seq_scan=%s idx_scan=%s | last_autovacuum=%s last_analyze=%s',
                  n, pg_size_pretty(pg_total_relation_size(s.relid)), pg_size_pretty(pg_relation_size(s.relid)),
                  s.n_tup_ins, s.n_tup_upd, s.n_tup_del, s.n_live_tup, s.seq_scan, coalesce(s.idx_scan, 0),
                  coalesce(date_trunc('minute', s.last_autovacuum)::text, '-'),
                  coalesce(date_trunc('minute', greatest(s.last_analyze, s.last_autoanalyze))::text, '-'))
      INTO ln FROM pg_stat_user_tables s WHERE s.relid = ('public.' || t)::regclass;
    RAISE NOTICE 'P27|%|stats|%', t, ln;

    -- time range on the first timestamp column (occurred_at / ran_at / created_at)
    SELECT a.attname INTO tcol FROM pg_attribute a
     WHERE a.attrelid = ('public.' || t)::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid = 'timestamptz'::regtype
     ORDER BY (a.attname IN ('occurred_at', 'ran_at', 'created_at')) DESC, a.attnum LIMIT 1;
    IF tcol IS NOT NULL THEN
      EXECUTE format('SELECT format(%L, %L, date_trunc(''minute'', min(%I)), date_trunc(''minute'', max(%I)),
                             count(*) FILTER (WHERE %I > now() - interval ''30 days''),
                             count(*) FILTER (WHERE %I > now() - interval ''1 day''))
                        FROM public.%I',
                     'time %s: min=%s max=%s last30d=%s last1d=%s', tcol, tcol, tcol, tcol, tcol, t) INTO ln;
      RAISE NOTICE 'P27|%|%', t, ln;
    END IF;

    IF t = 'v3_mirror_log' THEN
      FOR r IN EXECUTE 'SELECT action, count(*) c, count(*) FILTER (WHERE occurred_at > now() - interval ''30 days'') c30
                          FROM public.v3_mirror_log GROUP BY 1 ORDER BY 1' LOOP
        RAISE NOTICE 'P27|v3_mirror_log|action=%|rows=%|last30d=%', r.action, r.c, r.c30;
      END LOOP;
    END IF;

    SELECT string_agg(format('%s(%s,%s)', p.polname, p.polcmd, CASE WHEN p.polpermissive THEN 'perm' ELSE 'restr' END), '; ' ORDER BY p.polname)
      INTO ln FROM pg_policy p WHERE p.polrelid = ('public.' || t)::regclass;
    RAISE NOTICE 'P27|%|policies|%', t, coalesce(ln, 'none');

    SELECT string_agg(format('%s→%s(%s)', tg.tgname, tg.tgfoid::regproc, tg.tgenabled), '; ' ORDER BY tg.tgname)
      INTO ln FROM pg_trigger tg WHERE tg.tgrelid = ('public.' || t)::regclass AND NOT tg.tgisinternal;
    RAISE NOTICE 'P27|%|triggers_on|%', t, coalesce(ln, 'none');

    SELECT string_agg(format('%s %s.%s→%s', c.conname, c.conrelid::regclass, c.contype, c.confrelid::regclass), '; ' ORDER BY c.conname)
      INTO ln FROM pg_constraint c
     WHERE c.contype = 'f' AND (c.conrelid = ('public.' || t)::regclass OR c.confrelid = ('public.' || t)::regclass);
    RAISE NOTICE 'P27|%|fks|%', t, coalesce(ln, 'none');

    SELECT string_agg(DISTINCT v.oid::regclass::text, '; ')
      INTO ln FROM pg_depend d
      JOIN pg_rewrite rw ON rw.oid = d.objid
      JOIN pg_class v ON v.oid = rw.ev_class
     WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = ('public.' || t)::regclass AND v.oid <> d.refobjid;
    RAISE NOTICE 'P27|%|views|%', t, coalesce(ln, 'none');

    SELECT string_agg(pb.pubname, '; ') INTO ln FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid = pr.prpubid
     WHERE pr.prrelid = ('public.' || t)::regclass;
    RAISE NOTICE 'P27|%|publications|%', t, coalesce(ln, 'none');

    SELECT string_agg(format('%s.%s/%s', g.grantee, g.privilege_type, g.is_grantable), ', ' ORDER BY g.grantee, g.privilege_type)
      INTO ln FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public' AND g.table_name = t AND g.grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
    RAISE NOTICE 'P27|%|grants|%', t, coalesce(ln, 'none');

    -- functions whose body names the table
    fnames := ARRAY[]::text[];
    FOR r IN SELECT p.oid, n2.nspname || '.' || p.proname AS fn, l.lanname, p.prosecdef, p.prorettype = 'trigger'::regtype AS is_trg,
                    pg_get_function_identity_arguments(p.oid) AS args
               FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
              WHERE n2.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ILIKE '%' || t || '%'
              ORDER BY 2 LOOP
      fnames := fnames || r.fn;
      SELECT string_agg(format('%s ON %s (%s)', tg.tgname, tg.tgrelid::regclass, tg.tgenabled), '; ')
        INTO ln FROM pg_trigger tg WHERE tg.tgfoid = r.oid AND NOT tg.tgisinternal;
      RAISE NOTICE 'P27|%|fn|%(%)|lang=%|secdef=%|trigger_fn=%|attached=%|calls=%',
        t, r.fn, r.args, r.lanname, r.prosecdef, r.is_trg, coalesce(ln, 'none'),
        coalesce((SELECT f.calls::text FROM pg_stat_user_functions f WHERE f.funcid = r.oid), 'untracked');
    END LOOP;

    IF to_regclass('cron.job') IS NOT NULL THEN
      FOR r IN EXECUTE format($q$
          SELECT j.jobid, j.jobname, j.schedule, j.active,
                 (SELECT string_agg(x.status, ',' ORDER BY x.start_time DESC)
                    FROM (SELECT d.status, d.start_time FROM cron.job_run_details d
                           WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 5) x) AS last5,
                 (SELECT date_trunc('minute', max(d.start_time)) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run
            FROM cron.job j
           WHERE j.command ILIKE %L OR j.command ILIKE ANY (%L::text[])$q$,
          '%' || t || '%', (SELECT array_agg('%' || split_part(f, '.', 2) || '%') FROM unnest(fnames) f)) LOOP
        RAISE NOTICE 'P27|%|cron|#% %|%|active=%|last=%|last5=%', t, r.jobid, r.jobname, r.schedule, r.active, r.last_run, r.last5;
      END LOOP;
    END IF;
  END LOOP;

  -- ── P26 ────────────────────────────────────────────────────────────────
  IF to_regclass('public.db_audit_logs') IS NULL THEN
    RAISE NOTICE 'P26|db_audit_logs|exists=no';
  ELSE
    SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
      INTO ln FROM pg_attribute a
     WHERE a.attrelid = 'public.db_audit_logs'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    RAISE NOTICE 'P26|columns|%', ln;

    SELECT format('rows=%s total=%s heap=%s toast=%s indexes=%s | ins=%s upd=%s del=%s',
                  (SELECT count(*) FROM public.db_audit_logs),
                  pg_size_pretty(pg_total_relation_size(c.oid)), pg_size_pretty(pg_relation_size(c.oid)),
                  pg_size_pretty(coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0)),
                  pg_size_pretty(pg_indexes_size(c.oid)), s.n_tup_ins, s.n_tup_upd, s.n_tup_del)
      INTO ln FROM pg_class c JOIN pg_stat_user_tables s ON s.relid = c.oid WHERE c.oid = 'public.db_audit_logs'::regclass;
    RAISE NOTICE 'P26|size|%', ln;

    SELECT format('min=%s max=%s | <30d=%s 30-90d=%s 90-180d=%s 180-365d=%s >365d=%s',
                  date_trunc('day', min(created_at)), date_trunc('day', max(created_at)),
                  count(*) FILTER (WHERE created_at >  now() - interval '30 days'),
                  count(*) FILTER (WHERE created_at <= now() - interval '30 days'  AND created_at > now() - interval '90 days'),
                  count(*) FILTER (WHERE created_at <= now() - interval '90 days'  AND created_at > now() - interval '180 days'),
                  count(*) FILTER (WHERE created_at <= now() - interval '180 days' AND created_at > now() - interval '365 days'),
                  count(*) FILTER (WHERE created_at <= now() - interval '365 days'))
      INTO ln FROM public.db_audit_logs;
    RAISE NOTICE 'P26|age|%', ln;

    FOR r IN SELECT table_name, operation, count(*) c,
                    count(*) FILTER (WHERE created_at > now() - interval '30 days') c30,
                    pg_size_pretty(sum(coalesce(pg_column_size(old_data), 0) + coalesce(pg_column_size(new_data), 0))) bytes,
                    count(*) FILTER (WHERE old_data IS NOT NULL AND new_data IS NOT NULL) both_copies,
                    date_trunc('day', min(created_at)) first_at
               FROM public.db_audit_logs GROUP BY 1, 2 ORDER BY 3 DESC LOOP
      RAISE NOTICE 'P26|by|%|%|rows=%|last30d=%|stored=%|two_copies=%|first=%',
        r.table_name, r.operation, r.c, r.c30, r.bytes, r.both_copies, r.first_at;
    END LOOP;

    FOR r IN SELECT tg.tgname, tg.tgrelid::regclass AS tbl, tg.tgfoid::regproc AS fn, tg.tgenabled,
                    concat_ws('/', CASE WHEN tg.tgtype & 4 = 4 THEN 'INSERT' END,
                                   CASE WHEN tg.tgtype & 16 = 16 THEN 'UPDATE' END,
                                   CASE WHEN tg.tgtype & 8 = 8 THEN 'DELETE' END) AS events,
                    CASE WHEN tg.tgtype & 1 = 1 THEN 'row' ELSE 'stmt' END AS lvl
               FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
              WHERE NOT tg.tgisinternal AND p.prosrc ILIKE '%db_audit_logs%'
              ORDER BY 2::text, 1 LOOP
      RAISE NOTICE 'P26|trigger|%|ON %|%|%|fn=%|enabled=%', r.tgname, r.tbl, r.events, r.lvl, r.fn, r.tgenabled;
    END LOOP;

    SELECT string_agg(n2.nspname || '.' || p.proname, ', ' ORDER BY p.proname)
      INTO ln FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
     WHERE n2.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ILIKE '%db_audit_logs%'
       AND p.prorettype <> 'trigger'::regtype;
    RAISE NOTICE 'P26|other_functions|%', coalesce(ln, 'none');

    SELECT string_agg(format('%s(%s,%s)', p.polname, p.polcmd, array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles)), '+')), '; ')
      INTO ln FROM pg_policy p WHERE p.polrelid = 'public.db_audit_logs'::regclass;
    RAISE NOTICE 'P26|policies|%', coalesce(ln, 'none');

    SELECT string_agg(indexrelid::regclass::text || '=' || pg_size_pretty(pg_relation_size(indexrelid)), '; ')
      INTO ln FROM pg_index WHERE indrelid = 'public.db_audit_logs'::regclass;
    RAISE NOTICE 'P26|indexes|%', coalesce(ln, 'none');

    IF to_regclass('cron.job') IS NOT NULL THEN
      FOR r IN EXECUTE $q$SELECT jobid, jobname, schedule, active FROM cron.job WHERE command ILIKE '%db_audit_logs%' ORDER BY 1$q$ LOOP
        RAISE NOTICE 'P26|cron|#% %|%|active=%', r.jobid, r.jobname, r.schedule, r.active;
      END LOOP;
    END IF;
  END IF;

  RAISE NOTICE 'P0622|done';
END
$probe$;

ROLLBACK;
