-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · notification centre N0 · 0100 · map every place a notification is
-- made, on this lane. READ ONLY, ROLLBACK. Lane-asserted.
--
-- Prints:
--   MAKER    every public function or procedure that writes a notification
--            row, calls emit_notification, sends push / queues e-mail, or has
--            "notif" in its name (readers such as notif_group_key included,
--            flags empty, so N1 can capture them too) — with md5 of its source
--            (to compare with git) and heuristic flags (settings read? blocks
--            read? self-skip? dedup? rate limit? push / e-mail path?). Flags
--            are a guide; the bodies are read by hand for the gap list.
--   OTHERSCHEMA  functions outside `public` that write a notification table
--            (name + schema only) — so a maker elsewhere is not missed.
--   TRG      every trigger that fires a MAKER: table, name, timing, events,
--            function (no arguments, no WHEN clause — those can hold literals)
--   CALLER   every other function whose source names a MAKER
--   GRANT    the ACL of each MAKER
--   CRON     cron jobs touching notifications / push / e-mail (md5 of the
--            command only — a command can carry a key)
--   COL/IDX  shapes of the notification tables (defaults other than plain
--            functions / booleans / numbers shown as <literal>; partial-index
--            WHERE clauses shown as <predicate>)
--   SRC      md5 + length of each maker's source. NO SOURCE TEXT IS PRINTED:
--            the repository and this log are public, and review showed no
--            pattern screen can be trusted to catch every way a key can be
--            written in plpgsql. md5 is enough to match each body against git;
--            bodies that match nothing in git are read by a separate, narrowly
--            scoped PROBE in N1.
--   COUNT    aggregates only, each section its own block with its own
--            time budget: rows per type (plain, then detailed), per type per
--            day (30 d), across a block, duplicates within 60 s (rows),
--            grouping buckets, busiest recipient-day, admin rows per type,
--            emit-log, held results, settings opt-outs, push tokens by
--            platform, e-mail log by template + status, pg_net status codes,
--            alarms.
--
-- A COUNT section that prints no line found zero rows; a section that could
-- not run prints COUNT_SKIP with the reason. SELF_CHECK? is a pattern hint.
-- Stored free-text labels (type, kind, platform, status, template) print only
-- when they match ^[a-z][a-z0-9_-]{0,39}$ with no 8-hex run, else <other>.
-- CRON 'calls' lists only names that exist in pg_proc on this lane.
-- For SQL-standard (BEGIN ATOMIC) bodies the source searched and hashed is
-- pg_get_functiondef(), so its md5 never matches text in git (expected).
-- Never prints row data (no ids, names, messages, e-mail addresses).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
-- every section reports through NOTICE; a role default above notice would
-- silence them and make "no line" look like "zero rows"
SET LOCAL client_min_messages = notice;

DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;

\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

SELECT 'N0100_LANE', current_setting('p32.lane'), now(), version();

-- The maker set is repeated as a CTE in each query below (a READ ONLY
-- transaction refuses CREATE TEMP TABLE AS; the fixture proved it).

WITH n0_makers AS (
  SELECT p.oid, p.proname::text AS name, p.prokind::text AS kind,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
         CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END AS src,
         p.prosecdef AS secdef, l.lanname::text AS lang
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND ((CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(insert\s+into\s+("?public"?\.)?"?(user_notifications|admin_notifications|held_result_notifications|notification_emit_log)\M)'
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '\memit_notification\s*\('
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(send-push|send-broadcast-push|push_config|enqueue_email\s*\(|net\.http_post)'
          OR p.proname ~ '^(notify_|emit_|push_on_|backfill_judging_notifications)'
          OR p.proname ~* 'notif')
)
SELECT 'MAKER', sig, lang, CASE WHEN secdef THEN 'definer' ELSE 'invoker' END,
       length(src), md5(src),
       concat_ws(',',
         CASE WHEN kind = 'p' THEN 'PROCEDURE' END,
         CASE WHEN src ~* 'insert\s+into\s+(public\.)?user_notifications'  THEN 'W_USER' END,
         CASE WHEN src ~* 'insert\s+into\s+(public\.)?admin_notifications' THEN 'W_ADMIN' END,
         CASE WHEN src ~* 'insert\s+into\s+(public\.)?held_result_notifications' THEN 'W_HELD' END,
         CASE WHEN src ~* 'insert\s+into\s+(public\.)?notification_emit_log' THEN 'W_EMITLOG' END,
         CASE WHEN src ~* '\memit_notification\s*\(' AND name <> 'emit_notification' THEN 'CALLS_EMIT' END,
         CASE WHEN src ~* 'notification_preferences|get_notification_email_enabled' THEN 'READS_PREFS' END,
         CASE WHEN src ~* 'user_blocks|is_blocked|blocked_id' THEN 'READS_BLOCKS' END,
         CASE WHEN src ~* '((=|<>|!=|is\s+distinct\s+from|is\s+not\s+distinct\s+from)\s*(NEW|OLD)\.(user_id|actor_id|follower_id|requester_id|sender_id)\M|(NEW|OLD)\.(user_id|actor_id|follower_id|requester_id|sender_id)\s*(=|<>|!=|is\s+distinct|is\s+not\s+distinct)|actor_id\s*(=|<>|!=)\s*[a-z_.]*user_id)' THEN 'SELF_CHECK?' END,
         CASE WHEN src ~* 'on\s+conflict' THEN 'ON_CONFLICT' END,
         CASE WHEN src ~* 'dedup_key' THEN 'DEDUP_KEY' END,
         CASE WHEN src ~* 'not\s+exists\s*\(\s*select[^;]*(user_notifications|admin_notifications)' THEN 'EXISTS_GUARD' END,
         CASE WHEN src ~* '(interval\s+''[0-9]+\s*(second|minute|hour)|rate_limit|throttle)' THEN 'TIME_WINDOW' END,
         CASE WHEN src ~* 'net\.http_post|send-push|push_config' THEN 'PUSH_HTTP' END,
         CASE WHEN src ~* 'enqueue_email\s*\(|pgmq|email_template|_email_template' THEN 'EMAIL' END,
         CASE WHEN src ~* 'site_settings|feature_flag|_enabled\s*\(' THEN 'SWITCH?' END)
  FROM n0_makers ORDER BY sig;

-- ── makers outside public (names only) ────────────────────────────────────
SELECT 'OTHERSCHEMA', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
   AND n.nspname NOT LIKE 'pg\_%'
   AND p.prokind IN ('f', 'p')
   AND (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(user_notifications|admin_notifications|held_result_notifications|notification_emit_log)'
 ORDER BY 2, 3;

-- ── triggers that fire a maker ─────────────────────────────────────────────
WITH n0_makers AS (
  SELECT p.oid, p.proname::text AS name, p.prokind::text AS kind,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
         CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END AS src,
         p.prosecdef AS secdef, l.lanname::text AS lang
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND ((CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(insert\s+into\s+("?public"?\.)?"?(user_notifications|admin_notifications|held_result_notifications|notification_emit_log)\M)'
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '\memit_notification\s*\('
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(send-push|send-broadcast-push|push_config|enqueue_email\s*\(|net\.http_post)'
          OR p.proname ~ '^(notify_|emit_|push_on_|backfill_judging_notifications)'
          OR p.proname ~* 'notif')
)
SELECT 'TRG', c.relname, t.tgname, m.sig, t.tgenabled::text,
       CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE' WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF' ELSE 'AFTER' END,
       concat_ws(' OR ', CASE WHEN t.tgtype & 4 = 4 THEN 'INSERT' END, CASE WHEN t.tgtype & 16 = 16 THEN 'UPDATE' END,
                         CASE WHEN t.tgtype & 8 = 8 THEN 'DELETE' END, CASE WHEN t.tgtype & 32 = 32 THEN 'TRUNCATE' END),
       CASE WHEN t.tgtype & 1 = 1 THEN 'ROW' ELSE 'STATEMENT' END,
       CASE WHEN t.tgqual IS NOT NULL THEN 'has_when' ELSE '' END,
       CASE WHEN t.tgnargs > 0 THEN 'args=' || t.tgnargs ELSE '' END
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN n0_makers m ON m.oid = t.tgfoid
 WHERE NOT t.tgisinternal
 ORDER BY 2, 3;

-- ── other functions that call a maker by name ─────────────────────────────
WITH n0_makers AS (
  SELECT p.oid, p.proname::text AS name, p.prokind::text AS kind,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
         CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END AS src,
         p.prosecdef AS secdef, l.lanname::text AS lang
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND ((CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(insert\s+into\s+("?public"?\.)?"?(user_notifications|admin_notifications|held_result_notifications|notification_emit_log)\M)'
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '\memit_notification\s*\('
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(send-push|send-broadcast-push|push_config|enqueue_email\s*\(|net\.http_post)'
          OR p.proname ~ '^(notify_|emit_|push_on_|backfill_judging_notifications)'
          OR p.proname ~* 'notif')
)
SELECT 'CALLER', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', m.name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  JOIN n0_makers m ON p.oid <> m.oid AND (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* ('\m' || m.name || '\s*\(')
 WHERE p.oid NOT IN (SELECT oid FROM n0_makers)
 ORDER BY 2, 3;

-- ── grants on the makers (who can call them directly) ─────────────────────
WITH n0_makers AS (
  SELECT p.oid, p.proname::text AS name, p.prokind::text AS kind,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
         CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END AS src,
         p.prosecdef AS secdef, l.lanname::text AS lang
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND ((CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(insert\s+into\s+("?public"?\.)?"?(user_notifications|admin_notifications|held_result_notifications|notification_emit_log)\M)'
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '\memit_notification\s*\('
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(send-push|send-broadcast-push|push_config|enqueue_email\s*\(|net\.http_post)'
          OR p.proname ~ '^(notify_|emit_|push_on_|backfill_judging_notifications)'
          OR p.proname ~* 'notif')
)
SELECT 'GRANT', m.sig, coalesce(p.proacl::text, '<default>')
  FROM n0_makers m JOIN pg_proc p ON p.oid = m.oid ORDER BY 2;

-- ── cron jobs (md5 of command only) ───────────────────────────────────────
DO $c$ DECLARE r record; BEGIN
  FOR r IN EXECUTE $q$
    SELECT jobname, schedule, active, md5(command) AS h, length(command) AS len,
           (SELECT string_agg(DISTINCT m[1], ',') FROM regexp_matches(command, '\m([a-z_][a-z0-9_]*)\s*\(', 'g') m
             WHERE EXISTS (SELECT 1 FROM pg_proc pp WHERE pp.proname = m[1])) AS calls
      FROM cron.job
     WHERE command ~* '(notif|push|email|mail|birthday|digest|reengag|emit_|backfill_judging)'
     ORDER BY jobname $q$
  LOOP
    RAISE NOTICE 'CRON|%|%|%|%|%|%', r.jobname, r.schedule, r.active, r.h, r.len, r.calls;
  END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'CRON_SKIP|%', SQLERRM;
END $c$;

-- ── table shapes ──────────────────────────────────────────────────────────
SELECT 'COL', c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod),
       a.attnotnull,
       CASE WHEN d.adbin IS NULL THEN ''
            WHEN pg_get_expr(d.adbin, d.adrelid) ~ '^(now\(\)|gen_random_uuid\(\)|true|false|-?[0-9.]+|nextval\(''[a-z0-9_.]+''::regclass\)|CURRENT_TIMESTAMP|''\{\}''::[a-z\[\]]+|''(in_app|push|email|pending|sent|failed|queued)''::text)$'
              THEN pg_get_expr(d.adbin, d.adrelid)
            ELSE '<literal>' END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE c.relname IN ('user_notifications','admin_notifications','notification_preferences',
                     'notification_emit_log','held_result_notifications','push_tokens',
                     'push_config','email_send_log','user_blocks','ops_alarms')
   AND NOT (c.relname = 'push_config' AND a.attname NOT IN ('id','updated_at','function_url'))
 ORDER BY 2, 3;
SELECT 'IDX', c.relname, regexp_replace(regexp_replace(regexp_replace(pg_get_indexdef(i.indexrelid), '\s+', ' ', 'g'), ' WHERE .*$', ' WHERE <predicate>'), '''[^'']*''', '<lit>', 'g')
  FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relname IN ('user_notifications','admin_notifications','notification_preferences',
                     'notification_emit_log','held_result_notifications','push_tokens')
 ORDER BY 2, 3;
SELECT 'TBLTRG', c.relname, t.tgname, p.proname, t.tgenabled::text
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE NOT t.tgisinternal
   AND c.relname IN ('user_notifications','admin_notifications','notification_preferences',
                     'notification_emit_log','held_result_notifications','push_tokens')
 ORDER BY 2, 3;
-- no URL text at all: only whether a URL is set and whether it is a Supabase
-- functions URL (review: any host parser can be fooled by user:pass@)
DO $p$ DECLARE r record; BEGIN
  FOR r IN EXECUTE $q$SELECT count(*) AS n, bool_or(function_url IS NOT NULL) AS has_url,
                  bool_and(function_url ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/[a-z0-9-]+$') AS supabase_fn
             FROM public.push_config$q$
  LOOP RAISE NOTICE 'PUSHCFG|rows=%|url_set=%|plain_supabase_function_url=%', r.n, r.has_url, r.supabase_fn; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'PUSHCFG_SKIP|%', SQLERRM;
END $p$;

-- ── maker source fingerprint (md5 + length only; no text) ────────────────
WITH n0_makers AS (
  SELECT p.oid, p.proname::text AS name, p.prokind::text AS kind,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
         CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END AS src,
         p.prosecdef AS secdef, l.lanname::text AS lang
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND ((CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(insert\s+into\s+("?public"?\.)?"?(user_notifications|admin_notifications|held_result_notifications|notification_emit_log)\M)'
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '\memit_notification\s*\('
          OR (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END) ~* '(send-push|send-broadcast-push|push_config|enqueue_email\s*\(|net\.http_post)'
          OR p.proname ~ '^(notify_|emit_|push_on_|backfill_judging_notifications)'
          OR p.proname ~* 'notif')
)
SELECT 'SRC', sig, md5(src), length(src) FROM n0_makers ORDER BY 2;

-- ── counts: one block per section, each with its own time budget ──────────
-- A statement timeout (query_canceled) is not caught by WHEN OTHERS, so each
-- block also catches it by name and moves on.

DO $k1$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT type ~ '[0-9a-f]{8}' THEN type ELSE '<other>' END AS type, count(*) AS n FROM public.user_notifications GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|UN_TOTAL|%|%', r.type, r.n; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|UN_TOTAL|%', SQLERRM; END $k1$;

DO $k2$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT type ~ '[0-9a-f]{8}' THEN type ELSE '<other>' END AS type, created_at::date AS d, count(*) AS n
             FROM public.user_notifications
            WHERE created_at > now() - interval '30 days'
            GROUP BY 1, 2 ORDER BY 1, 2
  LOOP RAISE NOTICE 'COUNT|UN_DAY|%|%|%', r.type, r.d, r.n; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|UN_DAY|%', SQLERRM; END $k2$;

DO $k3$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT type ~ '[0-9a-f]{8}' THEN type ELSE '<other>' END AS type,
                  count(*) FILTER (WHERE created_at > now() - interval '30 days') AS d30,
                  count(*) FILTER (WHERE created_at > now() - interval '7 days')  AS d7,
                  count(*) FILTER (WHERE created_at > now() - interval '1 day')   AS d1,
                  count(*) FILTER (WHERE NOT is_read) AS unread,
                  count(*) FILTER (WHERE email_sent) AS emailed,
                  count(*) FILTER (WHERE actor_id IS NULL) AS no_actor,
                  count(*) FILTER (WHERE actor_id = user_id) AS self,
                  count(*) FILTER (WHERE dedup_key IS NOT NULL) AS dedup,
                  min(created_at)::date AS first, max(created_at)::date AS last
             FROM public.user_notifications GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|UN_TYPE|%|d30=%|d7=%|d1=%|unread=%|emailed=%|no_actor=%|self=%|dedup=%|first=%|last=%',
         r.type, r.d30, r.d7, r.d1, r.unread, r.emailed, r.no_actor, r.self, r.dedup, r.first, r.last; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|UN_TYPE|%', SQLERRM; END $k3$;

-- sent across a block (either direction), last 30 days, per type
DO $k4$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN un.type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT un.type ~ '[0-9a-f]{8}' THEN un.type ELSE '<other>' END AS type, count(*) AS n
             FROM public.user_notifications un
            WHERE un.created_at > now() - interval '30 days' AND un.actor_id IS NOT NULL
              AND (EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = un.user_id AND b.blocked_id = un.actor_id)
                OR EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = un.actor_id AND b.blocked_id = un.user_id))
            GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|UN_BLOCKED|%|%', r.type, r.n; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|UN_BLOCKED|%', SQLERRM; END $k4$;

-- duplicates: ROWS that follow an identical (recipient, type, actor,
-- reference) row by 60 s or less, last 30 days
DO $k5$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT type ~ '[0-9a-f]{8}' THEN type ELSE '<other>' END AS type, count(*) AS n
             FROM (SELECT type, created_at - lag(created_at) OVER (
                                  PARTITION BY user_id, type, actor_id, reference_id ORDER BY created_at) AS gap
                     FROM public.user_notifications
                    WHERE created_at > now() - interval '30 days') s
            WHERE gap <= interval '60 seconds'
            GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|UN_DUP60S_ROWS|%|%', r.type, r.n; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|UN_DUP60S_ROWS|%', SQLERRM; END $k5$;

-- grouping potential: per type, the busiest (recipient, reference, day)
-- bucket, and how many buckets hold 3+ rows (would read "A and N others")
DO $k6$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT type ~ '[0-9a-f]{8}' THEN type ELSE '<other>' END AS type, max(n) AS maxn, count(*) FILTER (WHERE n >= 3) AS groups3, coalesce(sum(n) FILTER (WHERE n >= 3), 0) AS rows3
             FROM (SELECT type, user_id, reference_id, created_at::date, count(*) AS n
                     FROM public.user_notifications
                    WHERE created_at > now() - interval '30 days'
                    GROUP BY 1, 2, 3, 4) s
            GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|UN_GROUP|%|max_bucket=%|buckets3=%|rows_in_buckets3=%', r.type, r.maxn, r.groups3, r.rows3; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|UN_GROUP|%', SQLERRM; END $k6$;

-- busiest recipient-day overall (rate-limit sizing), 30 d
DO $k7$ DECLARE r record; BEGIN
  FOR r IN SELECT max(n) AS maxn, percentile_disc(0.99) WITHIN GROUP (ORDER BY n) AS p99, count(*) AS days
             FROM (SELECT user_id, created_at::date, count(*) AS n FROM public.user_notifications
                    WHERE created_at > now() - interval '30 days' GROUP BY 1, 2) s
  LOOP RAISE NOTICE 'COUNT|UN_RECIPIENT_DAY|max=%|p99=%|recipient_days=%', r.maxn, r.p99, r.days; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|UN_RECIPIENT_DAY|%', SQLERRM; END $k7$;

DO $k8$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT type ~ '[0-9a-f]{8}' THEN type ELSE '<other>' END AS type, count(*) AS total,
                  count(*) FILTER (WHERE created_at > now() - interval '30 days') AS d30,
                  count(*) FILTER (WHERE created_at > now() - interval '7 days') AS d7,
                  count(*) FILTER (WHERE NOT is_read) AS unread,
                  max(created_at)::date AS last
             FROM public.admin_notifications GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|AN_TYPE|%|total=%|d30=%|d7=%|unread=%|last=%', r.type, r.total, r.d30, r.d7, r.unread, r.last; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|AN_TYPE|%', SQLERRM; END $k8$;

DO $k9$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN kind ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT kind ~ '[0-9a-f]{8}' THEN kind ELSE '<other>' END AS kind, count(*) AS total,
                  count(*) FILTER (WHERE created_at > now() - interval '30 days') AS d30,
                  count(*) FILTER (WHERE in_app_notification_id IS NOT NULL) AS inapp,
                  count(*) FILTER (WHERE email_message_id IS NOT NULL) AS email,
                  max(created_at)::date AS last
             FROM public.notification_emit_log GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|EMITLOG|%|total=%|d30=%|inapp=%|email=%|last=%', r.kind, r.total, r.d30, r.inapp, r.email, r.last; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|EMITLOG|%', SQLERRM; END $k9$;

DO $k10$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN kind ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT kind ~ '[0-9a-f]{8}' THEN kind ELSE '<other>' END AS kind, count(*) AS n, max(created_at)::date AS last
             FROM public.held_result_notifications GROUP BY 1 ORDER BY 1
  LOOP RAISE NOTICE 'COUNT|HELD|%|%|last=%', r.kind, r.n, r.last; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|HELD|%', SQLERRM; END $k10$;

-- notification_preferences: rows, and how many members turned each boolean
-- column OFF
DO $k11$ DECLARE col text; n bigint; total bigint; BEGIN
  SELECT count(*) INTO total FROM public.notification_preferences;
  RAISE NOTICE 'COUNT|PREFS_ROWS|%', total;
  FOR col IN SELECT attname FROM pg_attribute
              WHERE attrelid = 'public.notification_preferences'::regclass
                AND attnum > 0 AND NOT attisdropped AND atttypid = 'boolean'::regtype
              ORDER BY attnum
  LOOP
    EXECUTE format('SELECT count(*) FROM public.notification_preferences WHERE %I IS FALSE', col) INTO n;
    RAISE NOTICE 'COUNT|PREFS_OFF|%|%', col, n;
  END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|PREFS|%', SQLERRM; END $k11$;

DO $k12$ DECLARE r record; BEGIN
  FOR r IN EXECUTE 'SELECT CASE WHEN platform IS NULL THEN ''<null>'' WHEN platform ~ ''^[a-z][a-z0-9_-]{0,39}$'' AND NOT platform ~ ''[0-9a-f]{8}'' THEN platform ELSE ''<other>'' END AS p, count(*) AS n, count(DISTINCT user_id) AS u FROM public.push_tokens GROUP BY 1 ORDER BY 1'
  LOOP RAISE NOTICE 'COUNT|PUSH_TOKENS|%|tokens=%|members=%', r.p, r.n, r.u; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|PUSH_TOKENS|%', SQLERRM; END $k12$;

DO $k13$ DECLARE r record; BEGIN
  FOR r IN SELECT CASE WHEN template_name ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT template_name ~ '[0-9a-f]{8}' THEN template_name ELSE '<other>' END AS template_name, CASE WHEN status ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT status ~ '[0-9a-f]{8}' THEN status ELSE '<other>' END AS status, count(*) AS n, max(created_at)::date AS last
             FROM public.email_send_log WHERE created_at > now() - interval '30 days'
            GROUP BY 1, 2 ORDER BY 1, 2
  LOOP RAISE NOTICE 'COUNT|EMAIL_LOG|%|%|%|last=%', r.template_name, r.status, r.n, r.last; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|EMAIL_LOG|%', SQLERRM; END $k13$;

-- pg_net responses still retained (push goes out this way), by status
DO $k14$ DECLARE r record; BEGIN
  FOR r IN EXECUTE 'SELECT coalesce(status_code::text, ''<null>'') AS s, (error_msg IS NOT NULL) AS e, count(*) AS n, min(created) AS since FROM net._http_response GROUP BY 1, 2 ORDER BY 1, 2'
  LOOP RAISE NOTICE 'COUNT|PGNET|status=%|error=%|%|since=%', r.s, r.e, r.n, r.since; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|PGNET|%', SQLERRM; END $k14$;

-- alarms whose key mentions notification / push / e-mail (leading [a-z_] run only)
DO $k15$ DECLARE r record; BEGIN
  FOR r IN EXECUTE $q$SELECT coalesce(substring(alarm_key FROM '^[a-z_]{1,40}'), '<other>') || CASE WHEN alarm_key ~ '^[a-z_]{1,40}$' THEN '' ELSE '<…>' END AS k, count(*) AS n,
                             count(*) FILTER (WHERE closed_at IS NULL) AS open
                        FROM public.ops_alarms WHERE alarm_key ~* '(notif|push|mail)' GROUP BY 1 ORDER BY 1$q$
  LOOP RAISE NOTICE 'COUNT|ALARMS|%|%|open=%', r.k, r.n, r.open; END LOOP;
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE NOTICE 'COUNT_SKIP|ALARMS|%', SQLERRM; END $k15$;

SELECT 'N0100_DONE', now();
ROLLBACK;
