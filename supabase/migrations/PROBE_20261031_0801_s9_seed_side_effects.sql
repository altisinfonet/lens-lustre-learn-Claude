-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S9 · what can a seeded post set off? (Owner item 20, condition 1:
-- "re-measure first that staging sends nothing to members' phones / e-mail").
-- READ ONLY, ROLLBACK, lane-asserted. Never fails on findings. Prints object
-- names, cron schedules, flags and counts only — never row data, tokens,
-- e-mails, cron commands, trigger arguments or function bodies.
--
-- Conservative by design: a path is flagged if ANY function it can reach
-- does something outward. For each ROOT —
--   T  every user trigger on public.posts / public.user_notifications and
--      their partitions
--   J  EVERY cron job (all are listed; the functions its command names are
--      its roots)
-- the CLOSURE is followed up to 8 levels: functions named in a body
-- (name followed by "(", quoted or not), and for every table a body inserts
-- into, updates, deletes from or merges into (any schema), that table's
-- triggers. Function bodies include BEGIN ATOMIC ones. Flags are the union over the closure:
--   HTTP (net.http / pg_net / http_post / extensions.http / http_request),
--   EDGE_URL (functions/v1), push, email (e-mail / smtp / resend), queue
--   (pgmq.send / pgmq_public. / enqueue), notify (pg_notify / NOTIFY),
--   broadcast (realtime.send / broadcast), dynamic (EXECUTE).
--   The flagged closure members are named.
--   Q  every pgmq queue's depth
--   D  rows that can receive a push: non-null token-like columns in tables
--      named like device / push / fcm / expo / token / subscription, and
--      token-like columns on profiles (counts only)
--   P  realtime publications holding posts / user_notifications (or their
--      partitions); R replication slots (names only) — consumers OUTSIDE the
--      database (Realtime subscribers, edge functions, queue readers,
--      pollers) cannot be seen from SQL: P, R and Q are the clues.
--   A  current_user and whether it bypasses row-level security (cron.job is
--      filtered by RLS for roles that do not: bypassrls=f means J may be
--      incomplete)
-- NOT covered (listed so nobody reads silence as proof): rules on the two
-- tables, functions called from column defaults / CHECK / RLS expressions /
-- trigger WHEN clauses, and calls built with dynamic SQL (flagged 'dynamic').
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';

DO $probe$
DECLARE
  r record; j record; n bigint; flags text; members text;
  root_sql text; seen oid[]; frontier oid[]; nxt oid[]; f oid; body text; lvl int;
  pat_http constant text := '(net\.http|pg_net|http_post|http_get|extensions\.http|http_request)';
  tbls oid[] := ARRAY[]::oid[];
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  RAISE NOTICE 'S9S|lane=%|at=%', current_setting('p32.lane'), date_trunc('second', now());
  RAISE NOTICE 'S9S|A|current_user=%|bypassrls=%', current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user);

  -- the two tables and their partitions (to_regclass: a missing table is reported, not fatal)
  FOR r IN SELECT x, to_regclass('public.' || x) AS rel FROM unnest(ARRAY['posts', 'user_notifications']) x LOOP
    IF r.rel IS NULL THEN RAISE NOTICE 'S9S|missing table public.%', r.x; CONTINUE; END IF;
    tbls := tbls || r.rel::oid || coalesce((WITH RECURSIVE kids(oid) AS (
                                              SELECT inhrelid FROM pg_inherits WHERE inhparent = r.rel
                                              UNION SELECT i.inhrelid FROM pg_inherits i JOIN kids k ON i.inhparent = k.oid)
                                            SELECT array_agg(oid) FROM kids), ARRAY[]::oid[]);
  END LOOP;

  -- one loop over every root: triggers (kind T) then cron jobs (kind J). The cron part is
  -- added only when pg_cron is installed (a static reference would fail at plan time).
  root_sql := $q$
    SELECT 'T' AS kind, t.tgrelid::regclass::text AS label, t.tgname::text AS name, t.tgenabled::text AS state,
           NULL::text AS sched, NULL::text AS cmd, ARRAY[t.tgfoid] AS start
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid = ANY ($1)$q$;
  IF to_regclass('cron.job') IS NOT NULL THEN
    root_sql := root_sql || $q$
    UNION ALL
    SELECT 'J', 'cron', c.jobname::text, c.active::text, c.schedule::text, c.command::text,
           coalesce((SELECT array_agg(p.oid) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                      WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
                        AND strpos(lower(c.command), lower(p.proname)) > 0
                        AND c.command ~* ('(^|[^a-z0-9_$])' || regexp_replace(p.proname, '([^a-zA-Z0-9_])', '\\\1', 'g') || '"?\s*\(')),
                    ARRAY[]::oid[])
      FROM cron.job c$q$;
  ELSE
    RAISE NOTICE 'S9S|J|pg_cron not installed';
  END IF;
  FOR j IN EXECUTE root_sql || ' ORDER BY 1, 2, 3' USING tbls
  LOOP
    seen := j.start; frontier := j.start; lvl := 0;
    WHILE lvl < 8 AND cardinality(frontier) > 0 LOOP
      nxt := ARRAY[]::oid[];
      FOREACH f IN ARRAY frontier LOOP
        SELECT coalesce(nullif(prosrc, ''), pg_get_function_sqlbody(oid)) INTO body FROM pg_proc WHERE oid = f;
        CONTINUE WHEN body IS NULL;
        -- functions named in the body
        nxt := nxt || coalesce((SELECT array_agg(p.oid) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                                 WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
                                   AND p.oid <> ALL (seen) AND strpos(lower(body), lower(p.proname)) > 0
                                   AND body ~* ('(^|[^a-z0-9_$])' || regexp_replace(p.proname, '([^a-zA-Z0-9_])', '\\\1', 'g') || '"?\s*\(')), ARRAY[]::oid[]);
        -- triggers on tables the body inserts into (any schema)
        nxt := nxt || coalesce((SELECT array_agg(DISTINCT t.tgfoid)
                                  FROM regexp_matches(body, '(?:insert\s+into|update|delete\s+from|merge\s+into)\s+(?:only\s+)?(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?', 'gi') m
                                  JOIN pg_class c ON c.relname = lower(m[1])
                                  JOIN pg_trigger t ON t.tgrelid = c.oid AND NOT t.tgisinternal
                                 WHERE t.tgfoid <> ALL (seen)), ARRAY[]::oid[]);
      END LOOP;
      nxt := ARRAY(SELECT DISTINCT x FROM unnest(nxt) x WHERE x <> ALL (seen));
      seen := seen || nxt; frontier := nxt; lvl := lvl + 1;
    END LOOP;

    SELECT concat_ws(',',
             CASE WHEN bool_or(src ~* pat_http) THEN 'HTTP' END,
             CASE WHEN bool_or(src ~* 'functions/v1') THEN 'EDGE_URL' END,
             CASE WHEN bool_or(src ~* 'push') THEN 'push' END,
             CASE WHEN bool_or(src ~* '(e-?mail|smtp|resend)') THEN 'email' END,
             CASE WHEN bool_or(src ~* '(pgmq\.send|pgmq_public\.|enqueue)') THEN 'queue' END,
             CASE WHEN bool_or(src ~* '(pg_notify|\mnotify\s+[a-z_"])') THEN 'notify' END,
             CASE WHEN bool_or(src ~* '(realtime\.send|broadcast)') THEN 'broadcast' END,
             CASE WHEN bool_or(src ~* '\mexecute\M') THEN 'dynamic' END),
           string_agg(DISTINCT CASE WHEN src ~* (pat_http || '|functions/v1|push|e-?mail|smtp|resend|pg_notify|pgmq\.send|pgmq_public\.|enqueue|realtime\.send|broadcast')
                                    THEN fn END, ' ')
      INTO flags, members
      FROM (SELECT p.oid::regprocedure::text AS fn, coalesce(nullif(p.prosrc, ''), pg_get_function_sqlbody(p.oid)) AS src FROM pg_proc p WHERE p.oid = ANY (seen)
            UNION ALL SELECT '(cron command)', j.cmd WHERE j.cmd IS NOT NULL) s;  -- the command is matched, never printed
    IF j.kind = 'T' THEN
      RAISE NOTICE 'S9S|T|%|%|enabled=%|closure=%|flags=%|outward=%', j.label, j.name, j.state,
        cardinality(seen), coalesce(nullif(flags, ''), 'none'), coalesce(members, '-');
    ELSE
      RAISE NOTICE 'S9S|J|%|%|active=%|closure=%|flags=%|outward=%', j.name, j.sched, j.state,
        cardinality(seen), coalesce(nullif(flags, ''), 'none'), coalesce(members, '-');
    END IF;
  END LOOP;

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

  -- D: rows that can receive a push
  FOR r IN SELECT c.oid::regclass AS rel, c.relname, a.attname
             FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND (c.relname ~* '(device|push|fcm|expo|token|subscription)' OR c.relname = 'profiles')
              AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~* '(token|endpoint|subscription|fcm|expo|player_id)'
              AND a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'jsonb'::regtype, 'json'::regtype, 'text[]'::regtype)
            ORDER BY 2, 3 LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I IS NOT NULL', r.rel, r.attname) INTO n;
      RAISE NOTICE 'S9S|D|%.%|non_null=%', r.relname, r.attname, n;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'S9S|D|%.%|unreadable (SQLSTATE %)', r.relname, r.attname, SQLSTATE;
    END;
  END LOOP;

  -- P / R: what can see changes from outside
  FOR r IN SELECT pt.pubname, pt.schemaname || '.' || pt.tablename AS t
             FROM pg_publication_tables pt JOIN pg_namespace ns ON ns.nspname = pt.schemaname
             JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = pt.tablename
            WHERE c.oid = ANY (tbls) ORDER BY 1, 2 LOOP
    RAISE NOTICE 'S9S|P|%|%', r.pubname, r.t;
  END LOOP;
  FOR r IN SELECT slot_name, plugin, active FROM pg_replication_slots ORDER BY 1 LOOP
    RAISE NOTICE 'S9S|R|%|plugin=%|active=%', r.slot_name, r.plugin, r.active;
  END LOOP;
  RAISE NOTICE 'S9S|note|consumers outside the database (Realtime subscribers, edge functions, queue readers, pollers) are not visible from SQL; read P, R and Q';
  RAISE NOTICE 'S9S|done';
END
$probe$;

ROLLBACK;
