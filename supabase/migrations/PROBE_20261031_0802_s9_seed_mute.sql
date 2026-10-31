-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S9 · can a seed session write posts that set off NOTHING?
-- Owner item 21 (2026-10-31 16:45 UTC, #553): "mute seeded posts but delete
-- it after test" — step 1: seeded posts create no notifications, push calls,
-- e-mails or background jobs, on both notification paths, proven on a small
-- batch first. STAGING ONLY. ONE TRANSACTION, ALWAYS ROLLED BACK.
--
-- Method (no shared trigger is changed): the seed session sets
--   SET LOCAL session_replication_role = replica
-- so ordinary (ENABLE, origin) triggers do not fire for its own writes;
-- every other session, and every member, is unaffected. Triggers marked
-- ENABLE ALWAYS / ENABLE REPLICA would still fire — this PROBE measures the
-- effect rather than assuming it, and names any such trigger.
--
--   C  CONTROL: 50 seed-shaped public posts by the staging author with the
--      most followers, inserted normally, inside a savepoint that is rolled
--      back. Must produce > 0 rows in the watched places — proves the counts
--      can see a fan-out at all.
--   M  MUTED: the same 50 posts with session_replication_role = replica.
--      Must produce 0 rows in every watched place.
--   Watched (rows created by the batch, counted inside this transaction):
--      public.user_notifications, public.admin_notifications,
--      public.notification_emit_log (if present), every pgmq q_* table,
--      net.http_request_queue (outbound HTTP), public.post_hashtags,
--      public.feed_events, public.activity_logs (if present).
--   W  general guard: during the muted batch this transaction wrote to no
--      table other than posts (pg_stat_xact_all_tables, any schema).
--   J  cron jobs whose command or called function reads posts are listed
--      (they could act on committed seed rows later; a rolled-back PROBE
--      cannot run them) — decided before the 1 M run.
--   T  any trigger on posts / user_notifications that fires in replica mode
--      (tgenabled A or R) is listed.
--   P  public.posts must be in no publication (replica mode does not stop
--      logical decoding, so a published table would still stream every
--      committed seed row to Realtime subscribers); no extension that can act
--      outside the transaction (http, dblink, pg_background, wrappers,
--      untrusted languages) may be installed; no rule on posts fires in
--      replica mode.
-- Prints names and counts only. Seed ids: md5('50mm-seed-v1:post:' || n),
-- n = 999,951 … 1,000,000 (the census and teardown cover them; nothing
-- survives the ROLLBACK anyway).
-- ═══════════════════════════════════════════════════════════════════════════
-- REPEATABLE READ: every count sees one snapshot plus this transaction's own rows,
-- so queue workers deleting or adding rows meanwhile cannot hide or fake a delta.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET CONSTRAINTS ALL IMMEDIATE;  -- deferred triggers fire now, inside the measured window

DO $guard$
BEGIN
  IF current_setting('p32.lane', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'PROBE REFUSED — 0802 writes (rolled back) and runs on staging only (p32.lane=%)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$guard$;

CREATE TEMP TABLE s9m_watch (place text PRIMARY KEY, before bigint, ctl bigint, muted bigint) ON COMMIT DROP;

DO $probe$
DECLARE
  r record; n bigint; author uuid; followers bigint; ctl_total bigint := 0; mut_total bigint := 0;
  places text[] := ARRAY[]::text[]; p text; v_ctl jsonb := '{}'::jsonb;  -- control counts survive the savepoint rollback
  post_rels oid[]; w_before jsonb; j record;
BEGIN
  -- the most-followed author: the largest fan-out the seed could cause
  SELECT f.following_id, count(*) INTO author, followers FROM public.follows f
   GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1;
  IF author IS NULL THEN RAISE EXCEPTION 'PROBE FAIL 0802: no follows on staging — the control cannot show a fan-out'; END IF;
  -- the control runs real triggers: refuse if anything could act OUTSIDE this
  -- transaction before the rollback (synchronous HTTP, own connections)
  SELECT string_agg(extname, ', ') INTO p FROM pg_extension WHERE extname IN ('http', 'dblink', 'pg_background', 'wrappers', 'plpython3u', 'plperlu', 'plv8', 'pltclu', 'pljava', 'plr', 'postgres_fdw');
  IF p IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE REFUSED 0802 — extension(s) % can act outside the transaction; the control batch is not safe to run', p;
  END IF;
  -- posts itself plus any partitions (pg_partition_tree returns NO rows for a plain table)
  post_rels := ARRAY['public.posts'::regclass::oid]
               || coalesce((SELECT array_agg(relid::oid) FROM pg_partition_tree('public.posts'::regclass) WHERE relid <> 'public.posts'::regclass), ARRAY[]::oid[]);
  -- a trigger on posts (or a partition) that would still fire in replica mode makes muting impossible
  SELECT string_agg(t.tgname, ', ') INTO p FROM pg_trigger t
   WHERE t.tgrelid = ANY (post_rels) AND NOT t.tgisinternal AND t.tgenabled IN ('A', 'R');
  IF p IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0802: trigger(s) on posts fire even in replica mode: %', p; END IF;
  SELECT string_agg(rw.rulename, ', ') INTO p FROM pg_rewrite rw
   WHERE rw.ev_class = ANY (post_rels) AND rw.rulename <> '_RETURN' AND rw.ev_enabled IN ('A', 'R');
  IF p IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0802: rule(s) on posts fire even in replica mode: %', p; END IF;
  -- replica mode stops triggers and rules, NOT logical decoding: a published
  -- posts table would still send every committed seed row to Realtime clients
  SELECT string_agg(DISTINCT pub, ', ') INTO p FROM (
    SELECT pubname AS pub FROM pg_publication WHERE puballtables
    UNION SELECT pt.pubname FROM pg_publication_tables pt JOIN pg_namespace ns ON ns.nspname = pt.schemaname
            JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = pt.tablename WHERE c.oid = ANY (post_rels)) x;
  IF p IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 0802: public.posts is in publication(s) % — committed seed rows would reach Realtime subscribers', p;
  END IF;
  p := NULL;
  RAISE NOTICE 'S9M|author followers=%', followers;

  FOREACH p IN ARRAY ARRAY['public.user_notifications', 'public.admin_notifications', 'public.notification_emit_log',
                           'net.http_request_queue', 'public.post_hashtags', 'public.feed_events', 'public.activity_logs'] LOOP
    IF to_regclass(p) IS NOT NULL THEN places := places || p; END IF;
  END LOOP;
  FOR r IN SELECT 'pgmq.' || c.relname AS q FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'pgmq' AND c.relkind = 'r' AND c.relname LIKE 'q\_%' ORDER BY 1 LOOP
    places := places || r.q;
  END LOOP;
  FOREACH p IN ARRAY places LOOP
    EXECUTE format('SELECT count(*) FROM %s', p) INTO n;
    INSERT INTO s9m_watch VALUES (p, n, NULL, NULL);
  END LOOP;

  -- C: control (rolled back by the exception handler = savepoint rollback)
  BEGIN
    INSERT INTO public.posts (id, user_id, content, privacy, created_at, updated_at, post_kind, categories, likes_count, comments_count, shares_count)
    SELECT md5('50mm-seed-v1:post:' || g)::uuid, author, '[seed 50mm-seed-v1] ' || g || ' · mute probe control', 'public',
           timestamptz '2026-08-31 00:00:00+00' - g * interval '30 seconds', timestamptz '2026-08-31 00:00:00+00' - g * interval '30 seconds',
           'member', '{}'::text[], 0, 0, 0
      FROM generate_series(999951, 1000000) g;
    FOREACH p IN ARRAY places LOOP
      EXECUTE format('SELECT count(*) FROM %s', p) INTO n;
      v_ctl := v_ctl || jsonb_build_object(p, n);
    END LOOP;
    RAISE EXCEPTION 'S9M_CONTROL_DONE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'S9M_CONTROL_DONE' THEN RAISE; END IF;
  END;
  UPDATE s9m_watch SET ctl = (v_ctl ->> place)::bigint - before;

  -- M: muted. This transaction's own write counters, per table, right before the batch:
  PERFORM pg_stat_clear_snapshot();
  SELECT coalesce(jsonb_object_agg(relid::text, n_tup_ins + n_tup_upd + n_tup_del), '{}'::jsonb) INTO w_before FROM pg_stat_xact_all_tables;
  BEGIN
    SET LOCAL session_replication_role = replica;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'PROBE FAIL 0802: this role may not set session_replication_role (%)', SQLSTATE;
  END;
  INSERT INTO public.posts (id, user_id, content, privacy, created_at, updated_at, post_kind, categories, likes_count, comments_count, shares_count)
  SELECT md5('50mm-seed-v1:post:' || g)::uuid, author, '[seed 50mm-seed-v1] ' || g || ' · mute probe', 'public',
         timestamptz '2026-08-31 00:00:00+00' - g * interval '30 seconds', timestamptz '2026-08-31 00:00:00+00' - g * interval '30 seconds',
         'member', '{}'::text[], 0, 0, 0
    FROM generate_series(999951, 1000000) g;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 50 THEN RAISE EXCEPTION 'PROBE FAIL 0802: muted batch inserted % of 50 posts', n; END IF;
  -- general guard: the muted batch wrote to NO table other than posts (any schema, listed or not)
  PERFORM pg_stat_clear_snapshot();
  SELECT string_agg(x.relid::regclass::text || ' +' || (x.w - coalesce((w_before ->> x.relid::text)::bigint, 0)), ', ') INTO p
    FROM (SELECT relid, n_tup_ins + n_tup_upd + n_tup_del AS w FROM pg_stat_xact_all_tables) x
   WHERE x.w > coalesce((w_before ->> x.relid::text)::bigint, 0) AND x.relid <> ALL (post_rels)
     AND x.relid::regclass::text NOT LIKE 'pg_temp%.s9m_watch' AND x.relid::regclass::text <> 's9m_watch';
  IF p IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0802: the muted batch wrote to other tables: %', p; END IF;
  -- the guard can see writes at all: posts' own counter rose by exactly the 50 muted rows
  SELECT sum(x.n_tup_ins) - coalesce(sum((w_before ->> x.relid::text)::bigint), 0) INTO n
    FROM pg_stat_xact_all_tables x WHERE x.relid = ANY (post_rels);
  IF n IS DISTINCT FROM 50 THEN RAISE EXCEPTION 'PROBE FAIL 0802: the write counters do not show the 50 muted posts (saw %) — the guard cannot see writes', n; END IF;
  FOREACH p IN ARRAY places LOOP
    EXECUTE format('SELECT count(*) FROM %s', p) INTO n;
    UPDATE s9m_watch SET muted = n - before WHERE place = p;
  END LOOP;
  SET LOCAL session_replication_role = origin;

  FOR r IN SELECT * FROM s9m_watch ORDER BY place LOOP
    RAISE NOTICE 'S9M|%|control=+%|muted=+%', r.place, r.ctl, r.muted;
    ctl_total := ctl_total + coalesce(r.ctl, 0); mut_total := mut_total + coalesce(r.muted, 0);
  END LOOP;
  FOR r IN SELECT t.tgrelid::regclass::text AS tbl, t.tgname, t.tgenabled FROM pg_trigger t
            WHERE NOT t.tgisinternal AND t.tgenabled IN ('A', 'R')
              AND t.tgrelid IN ('public.posts'::regclass, coalesce(to_regclass('public.user_notifications'), 'public.posts'::regclass)) LOOP
    RAISE NOTICE 'S9M|T|fires in replica mode|%|%|%', r.tbl, r.tgname, r.tgenabled;
  END LOOP;

  -- the control must show the notification path AND an outbound path
  IF coalesce((SELECT ctl FROM s9m_watch WHERE place = 'public.user_notifications'), 0) <= 0 THEN
    RAISE EXCEPTION 'PROBE FAIL 0802: the control batch made no notification — the counts cannot show a fan-out';
  END IF;
  IF coalesce((SELECT sum(ctl) FROM s9m_watch WHERE place = 'net.http_request_queue' OR place LIKE 'pgmq.q\_%'), 0) <= 0 THEN
    RAISE EXCEPTION 'PROBE FAIL 0802: the control batch made no queue or HTTP row — the outbound path is not shown';
  END IF;
  SELECT string_agg(place || ' +' || muted, ', ') INTO p FROM s9m_watch WHERE muted IS DISTINCT FROM 0;
  IF p IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0802: the muted batch still changed: %', p; END IF;
  -- pollers: jobs that may read committed posts LATER (not testable inside a rolled-back
  -- transaction). Listed for a decision before the 1 M run, with outward flags.
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR j IN EXECUTE $q$
      SELECT c.jobname, c.schedule, c.active,
             bool_or(coalesce(nullif(pr.prosrc, ''), pg_get_function_sqlbody(pr.oid)) ~* '\mposts\M') OR c.command ~* '\mposts\M' AS reads_posts,
             bool_or(coalesce(nullif(pr.prosrc, ''), pg_get_function_sqlbody(pr.oid)) ~* '(net\.http|functions/v1|push|e-?mail|enqueue)') OR c.command ~* '(net\.http|functions/v1)' AS outward
        FROM cron.job c
        LEFT JOIN pg_proc pr ON strpos(lower(c.command), lower(pr.proname)) > 0
             AND pr.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
             AND c.command ~* ('(^|[^a-z0-9_$])' || regexp_replace(pr.proname, '([^a-zA-Z0-9_])', '\\\1', 'g') || '"?\s*\(')
       GROUP BY c.jobname, c.schedule, c.active, c.command ORDER BY 1$q$ LOOP
      IF j.reads_posts THEN
        RAISE NOTICE 'S9M|poller|%|%|active=%|outward=%', j.jobname, j.schedule, j.active, coalesce(j.outward, false);
      END IF;
    END LOOP;
  END IF;
  RAISE NOTICE 'PROBE PASS 0802 — insert-time fan-out muted: control +% rows; muted 50 posts wrote to no table but posts (% watched places +0); posts unpublished; jobs that read posts later are listed as S9M|poller (decide before the 1 M run). All rolled back.', ctl_total, cardinality(places);
END
$probe$;

ROLLBACK;
