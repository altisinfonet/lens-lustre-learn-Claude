-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · cleanup runner 0501 · usage inventory for obsolete-object review.
-- READ ONLY, ROLLBACK. Prints object NAMES and COUNTS only: no row data, no
-- function bodies, no cron commands, no site_settings values, no storage
-- object names. Changes nothing. Applied only via apply-migration.yml.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;

\pset pager off
\pset format unaligned
\pset fieldsep '|'

SELECT 'CLEAN0501_LANE', current_setting('p32.lane'), now(),
       current_setting('track_functions'),
       (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database());

-- 1. App builds still in use (last 30 days), counts only.
SELECT 'BUILD_TELEMETRY', platform, app_build, count(*), min(created_at)::date, max(created_at)::date
  FROM public.client_telemetry
 WHERE created_at > now() - interval '30 days'
 GROUP BY 2, 3 ORDER BY 2, 3;
SELECT 'BUILD_ERRORS', coalesce(platform, '?'), coalesce(app_build, '?'), count(*), min(created_at)::date, max(created_at)::date
  FROM public.client_errors
 WHERE created_at > now() - interval '30 days'
 GROUP BY 2, 3 ORDER BY 2, 3;

-- 2. Every app function with its in-database reference counts and call count.
WITH f AS (
  SELECT p.oid, n.nspname, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private', 'app', 'internal')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
), bodies AS MATERIALIZED (
  SELECT p.oid, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private', 'app', 'internal', 'auth', 'storage')
), pol AS MATERIALIZED (
  SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS t FROM pg_policies
), vw AS MATERIALIZED (
  SELECT pg_get_viewdef(c.oid) AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('v', 'm') AND n.nspname IN ('public', 'private', 'app', 'internal')
), dflt AS MATERIALIZED (
  SELECT pg_get_expr(adbin, adrelid) AS t FROM pg_attrdef
)
SELECT 'FNREF', f.nspname, f.proname,
       (SELECT count(*) FROM bodies b WHERE b.oid <> f.oid AND b.prosrc ~ ('\m' || f.proname || '\M')),
       (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = f.oid AND NOT t.tgisinternal),
       (SELECT count(*) FROM pol WHERE pol.t ~ ('\m' || f.proname || '\M')),
       (SELECT count(*) FROM vw WHERE vw.t ~ ('\m' || f.proname || '\M')),
       (SELECT count(*) FROM dflt WHERE dflt.t ~ ('\m' || f.proname || '\M')),
       (SELECT count(*) FROM cron.job j WHERE j.command ~ ('\m' || f.proname || '\M')),
       (SELECT count(*) FROM pg_event_trigger e WHERE e.evtfoid = f.oid),
       coalesce((SELECT s.calls FROM pg_stat_user_functions s WHERE s.funcid = f.oid), -1)
  FROM f ORDER BY 2, 3;

-- 3. Every app table/view: size, activity counters, and in-database references.
WITH r AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'private', 'app', 'internal') AND c.relkind IN ('r', 'p', 'v', 'm')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
), bodies AS MATERIALIZED (
  SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private', 'app', 'internal', 'auth', 'storage')
)
SELECT 'RELUSE', r.nspname, r.relname, r.relkind,
       coalesce(s.n_live_tup, -1), pg_total_relation_size(r.oid),
       coalesce(s.seq_scan, -1), coalesce(s.idx_scan, -1),
       coalesce(s.n_tup_ins, -1), coalesce(s.n_tup_upd, -1), coalesce(s.n_tup_del, -1),
       (SELECT count(*) FROM bodies b WHERE b.prosrc ~ ('\m' || r.relname || '\M')),
       (SELECT count(*) FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
         WHERE d.refobjid = r.oid AND w.ev_class <> r.oid),
       (SELECT count(*) FROM pg_constraint k WHERE k.confrelid = r.oid),
       (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = r.oid AND NOT t.tgisinternal),
       (SELECT count(*) FROM cron.job j WHERE j.command ~ ('\m' || r.relname || '\M'))
  FROM r LEFT JOIN pg_stat_user_tables s ON s.relid = r.oid
 ORDER BY 2, 3;

-- 4. Duplicate indexes (same table, columns, opclasses, expressions, predicate).
SELECT 'DUPIDX', n.nspname, t.relname,
       string_agg(i.relname || ':' || coalesce(st.idx_scan, -1) || ':' || x.indisunique::text || ':' || x.indisprimary::text, ',' ORDER BY i.relname)
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class t ON t.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  LEFT JOIN pg_stat_user_indexes st ON st.indexrelid = x.indexrelid
 WHERE n.nspname IN ('public', 'private', 'app', 'internal')
 GROUP BY n.nspname, t.relname, x.indrelid, x.indkey::text, x.indclass::text,
          coalesce(pg_get_expr(x.indexprs, x.indrelid), ''), coalesce(pg_get_expr(x.indpred, x.indrelid), '')
HAVING count(*) > 1
 ORDER BY 2, 3;

-- 5. Cron jobs: name, schedule, active, last run (no command text).
SELECT 'CRON', j.jobname, j.schedule, j.active,
       (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid),
       (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1),
       (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > now() - interval '7 days')
  FROM cron.job j ORDER BY 2;

-- 6. site_settings keys (names, size and last update only — never values).
SELECT 'SETKEY', key, length(value::text), updated_at::date FROM public.site_settings ORDER BY 2;

-- 7. Storage per bucket: object count, bytes, and how many are older than 30 days.
SELECT 'BUCKET', bucket_id, count(*),
       coalesce(sum(CASE WHEN metadata->>'size' ~ '^[0-9]{1,18}$' THEN (metadata->>'size')::bigint END), 0),
       count(*) FILTER (WHERE created_at < now() - interval '30 days')
  FROM storage.objects GROUP BY 2 ORDER BY 2;

-- 8. Edge functions called from inside the database: only the function NAME
--    extracted from '/functions/v1/<name>' in cron commands and function bodies.
SELECT 'EDGE_CRON', j.jobname, m[1]
  FROM cron.job j, LATERAL regexp_matches(j.command, '/functions/v1/([A-Za-z0-9_-]+)', 'g') AS m
 ORDER BY 2, 3;
SELECT 'EDGE_FNBODY', m[1], count(DISTINCT p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
       LATERAL regexp_matches(p.prosrc, '/functions/v1/([A-Za-z0-9_-]+)', 'g') AS m
 WHERE n.nspname IN ('public', 'private', 'app', 'internal')
 GROUP BY 2 ORDER BY 2;

SELECT 'CLEAN0501_DONE', now();
ROLLBACK;
