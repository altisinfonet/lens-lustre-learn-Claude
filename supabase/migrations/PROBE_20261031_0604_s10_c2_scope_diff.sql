-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 C-2 · which indexes make the linter count (L) differ from the
-- public-only count (M2). READ ONLY, ROLLBACK. Never fails on findings.
-- Prints schema.table.index names and sizes only (no row data; public log).
--
-- Why: hold H-1 must "account for the 79" — the plan's number, one more than
-- the linter's 78 and M2's 78 on 2026-09-02. L and M2 differ only by scope:
--   L ∖ M2 = unused, not PK/unique, not extension-owned, in an app schema
--            OTHER than public (counted by L, not by M2);
--   M2 ∖ L = unused, not PK/unique, in public, but on an extension-owned
--            table (counted by M2, not by L).
-- Same definitions as PROBE_20261031_0603 (same schema list, same filters).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  sys_schemas text[] := ARRAY['auth','storage','realtime','graphql','graphql_public','extensions',
                              'vault','cron','net','pgsodium','pgsodium_masks','supabase_functions',
                              'supabase_migrations','_realtime','_analytics','pgbouncer','pg_net',
                              '_timescaledb_cache','_timescaledb_catalog','_timescaledb_config','_timescaledb_internal',
                              'pgroonga','pgtle','repack','tiger','topology'];
  l_not_m2 text; m2_not_l text; n_l_not_m2 int; n_m2_not_l int;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  WITH _ix AS (
  SELECT s.schemaname AS sch, s.indexrelname AS iname, s.relname AS tname,
         coalesce(s.idx_scan, 0) AS scans,
         i.indisunique AS uniq, i.indisprimary AS pk,
         EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = s.relid AND d.deptype = 'e') AS ext_owned,
         pg_relation_size(s.indexrelid) AS bytes
    FROM pg_stat_all_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
   WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
     AND s.schemaname NOT LIKE 'pg_toast%' AND s.schemaname NOT LIKE 'pg_temp%'),
  base AS (SELECT * FROM _ix WHERE scans = 0 AND NOT uniq AND NOT pk)
  SELECT count(*) FILTER (WHERE sch <> 'public' AND NOT ext_owned AND NOT sch = ANY (sys_schemas)),
         string_agg(format('%s.%s.%s(%s)', sch, tname, iname, pg_size_pretty(bytes)), ', ' ORDER BY sch, tname, iname)
           FILTER (WHERE sch <> 'public' AND NOT ext_owned AND NOT sch = ANY (sys_schemas)),
         count(*) FILTER (WHERE sch = 'public' AND ext_owned),
         string_agg(format('%s.%s.%s(%s)', sch, tname, iname, pg_size_pretty(bytes)), ', ' ORDER BY sch, tname, iname)
           FILTER (WHERE sch = 'public' AND ext_owned)
    INTO n_l_not_m2, l_not_m2, n_m2_not_l, m2_not_l
    FROM base;

  RAISE NOTICE E'C-2 SCOPE DIFF (lane %):\n  L not M2 (app schemas other than public) = %: %\n  M2 not L (public, extension-owned table) = %: %',
    current_setting('p32.lane'), n_l_not_m2, coalesce(l_not_m2, 'none'), n_m2_not_l, coalesce(m2_not_l, 'none');
END
$probe$;

ROLLBACK;
