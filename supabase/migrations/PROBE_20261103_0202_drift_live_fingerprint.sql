-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation fix unit 1 · 0202 · LIVE FINGERPRINT for the drift check.
-- READ ONLY, ROLLBACK. Prints object NAMES and md5 HASHES of definitions —
-- never a definition body, never row data, never a cron command.
--   FN    public functions: name | argument types | definer? | md5(body, whitespace-collapsed)
--   TBL   public tables
--   POL   policies on public tables: table | name | command
--   TRG   app triggers (public / storage / auth tables): table | trigger | function
--   CRON  pg_cron jobs: name | schedule | md5(command, whitespace-collapsed)
-- Used twice: dispatched through apply-migration.yml as a PROBE, and run by
-- .github/workflows/db-drift.yml, which compares it with git
-- (scripts/db-drift-check.mjs).
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
\pset tuples_only on
\pset fieldsep '|'

SELECT 'DRIFT_LANE', current_setting('p32.lane'), now();

SELECT 'FN', p.proname, oidvectortypes(p.proargtypes), CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END,
       md5(regexp_replace(btrim(coalesce(nullif(p.prosrc, ''), pg_get_function_sqlbody(p.oid), '')), '\s+', ' ', 'g'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
 ORDER BY 2, 3;

SELECT 'TBL', c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
 ORDER BY 2;

SELECT 'POL', tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY 2, 3;

SELECT 'TRG', c.relname, t.tgname, p.proname
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth', 'storage') AND pn.nspname = 'public'
 ORDER BY 2, 3;

SELECT 'CRON', jobname, schedule, md5(regexp_replace(btrim(command), '\s+', ' ', 'g'))
  FROM cron.job ORDER BY 2;

SELECT 'DRIFT_DONE', now();
ROLLBACK;
