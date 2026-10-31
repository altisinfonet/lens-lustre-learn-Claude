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
--   T  any trigger on posts / user_notifications that fires in replica mode
--      (tgenabled A or R) is listed.
-- Prints names and counts only. Seed ids: md5('50mm-seed-v1:post:' || n),
-- n = 999,951 … 1,000,000 (the census and teardown cover them; nothing
-- survives the ROLLBACK anyway).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

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
BEGIN
  -- the most-followed author: the largest fan-out the seed could cause
  SELECT f.following_id, count(*) INTO author, followers FROM public.follows f
   GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1;
  IF author IS NULL THEN RAISE EXCEPTION 'PROBE FAIL 0802: no follows on staging — the control cannot show a fan-out'; END IF;
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

  -- M: muted
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

  IF ctl_total = 0 THEN RAISE EXCEPTION 'PROBE FAIL 0802: the control batch produced nothing — the counts cannot show a fan-out'; END IF;
  IF mut_total <> 0 THEN RAISE EXCEPTION 'PROBE FAIL 0802: the muted batch still produced % row(s) (lines S9M| above)', mut_total; END IF;
  RAISE NOTICE 'PROBE PASS 0802 — control +% rows; muted 50 posts +0 rows in % watched places (all rolled back)', ctl_total, cardinality(places);
END
$probe$;

ROLLBACK;
