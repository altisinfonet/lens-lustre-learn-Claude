-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation audit 0901 · live object inventory. READ ONLY, ROLLBACK.
-- Lists object NAMES only (functions, tables, views, policies, triggers, cron
-- job names + schedules, extensions) so an auditor can diff live against git.
-- Prints no row data, no function bodies, no cron commands (they can hold
-- URLs/keys) — only an md5 of each cron command. Changes nothing.
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

SELECT 'AUDIT0901_LANE', current_setting('p32.lane'), now();

-- functions in app schemas (name + identity args)
SELECT 'FN', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
       CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('public', 'private', 'app', 'internal')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
 ORDER BY 2, 3, 4;

-- tables / views / matviews
SELECT 'REL', n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'private', 'app', 'internal')
   AND c.relkind IN ('r', 'p', 'v', 'm')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
 ORDER BY 2, 3;

-- RLS policies (name only)
SELECT 'POL', schemaname, tablename, policyname, cmd, array_to_string(roles, ',')
  FROM pg_policies WHERE schemaname IN ('public', 'storage') ORDER BY 2, 3, 4;

-- triggers (non-internal)
SELECT 'TRG', n.nspname, c.relname, t.tgname, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'storage', 'auth')
 ORDER BY 2, 3, 4;

-- extensions
SELECT 'EXT', extname, extversion FROM pg_extension ORDER BY 2;

-- cron jobs: name, schedule, active, md5(command) — never the command itself
DO $c$
DECLARE r record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RAISE NOTICE 'CRON none'; RETURN; END IF;
  FOR r IN EXECUTE 'SELECT jobname, schedule, active, md5(command) h FROM cron.job ORDER BY jobname' LOOP
    RAISE NOTICE 'CRON|%|%|%|%', r.jobname, r.schedule, r.active, left(r.h, 10);
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BLOCK_ERROR|cron|%', SQLSTATE;
END $c$;

SELECT 'AUDIT0901_DONE', now();
ROLLBACK;
