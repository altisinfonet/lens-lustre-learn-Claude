-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 C-2 · unused-index counts, every method, one sitting.
-- READ ONLY, ROLLBACK. Never fails on findings; it measures. Prints counts,
-- the statistics window, and the index NAMES the proposed method selects
-- (names and sizes only — no row data; the Actions log is public).
--
-- The hold (GATE_REGISTER H-1): four methods gave four numbers — 79 (plan),
-- 78 (Supabase linter), "298 of which 125" and 188. D1's R2 candidate
-- (2026-09-02) explained four of them as one population on two axes:
--   M1  public, idx_scan = 0, every index                      (188 then)
--   M2  public, idx_scan = 0, excluding PK / unique indexes     (78)
--   M3  all non-system schemas, every index                    (298)
--   M4  all non-system schemas, excluding PK / unique           (125)
--   M5  denominator: every index, all non-system schemas        (594)
-- and not the plan's 79. This PROBE re-takes all five on the lane, plus:
--   L   the Supabase linter's "unused_index" rule as published (idx_scan = 0,
--       not unique, not primary, not owned by an extension, outside Supabase's
--       own schemas) — the method the plan's 79 most likely came from;
--   P   the PROPOSED method = L restricted to schema public, minus indexes
--       that back a foreign key's referencing columns (deletes on the parent
--       rely on them even when no query scans them), judged only when the
--       statistics window is ≥ 14 days old.
-- "Non-system schemas" = everything except pg_catalog, information_schema,
-- pg_toast*, pg_temp*. Supabase's own schemas (auth, storage, realtime,
-- graphql*, extensions, vault, cron, net, pgsodium*, supabase_*) are counted in
-- M3/M4/M5 but excluded from L and P — we do not own those indexes.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  sys_schemas text[] := ARRAY['auth','storage','realtime','graphql','graphql_public','extensions',
                              'vault','cron','net','pgsodium','pgsodium_masks','supabase_functions',
                              'supabase_migrations','_realtime','_analytics','pgbouncer','pg_net'];
  m1 int; m2 int; m3 int; m4 int; m5 int; l int; p int;
  reset_at timestamptz; window_days numeric;
  names text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  SELECT stats_reset INTO reset_at FROM pg_stat_database WHERE datname = current_database();
  window_days := round(extract(epoch FROM now() - coalesce(reset_at, pg_postmaster_start_time())) / 86400.0, 1);



  WITH _ix AS (
  SELECT s.schemaname AS sch, s.indexrelname AS iname, s.relname AS tname,
         s.indexrelid, s.relid, coalesce(s.idx_scan, 0) AS scans,
         i.indisunique AS uniq, i.indisprimary AS pk,
         EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = s.relid AND d.deptype = 'e') AS ext_owned,
         EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.contype = 'f' AND c.conrelid = s.relid
                    AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey) AS backs_fk,
         pg_relation_size(s.indexrelid) AS bytes
    FROM pg_stat_all_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
   WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
     AND s.schemaname NOT LIKE 'pg_toast%' AND s.schemaname NOT LIKE 'pg_temp%')
  SELECT count(*) FILTER (WHERE sch = 'public' AND scans = 0),
         count(*) FILTER (WHERE sch = 'public' AND scans = 0 AND NOT uniq AND NOT pk),
         count(*) FILTER (WHERE scans = 0),
         count(*) FILTER (WHERE scans = 0 AND NOT uniq AND NOT pk),
         count(*),
         count(*) FILTER (WHERE scans = 0 AND NOT uniq AND NOT pk AND NOT ext_owned AND NOT sch = ANY (sys_schemas)),
         count(*) FILTER (WHERE sch = 'public' AND scans = 0 AND NOT uniq AND NOT pk AND NOT ext_owned AND NOT backs_fk)
    INTO m1, m2, m3, m4, m5, l, p
    FROM _ix;

  WITH _ix AS (
  SELECT s.schemaname AS sch, s.indexrelname AS iname, s.relname AS tname,
         s.indexrelid, s.relid, coalesce(s.idx_scan, 0) AS scans,
         i.indisunique AS uniq, i.indisprimary AS pk,
         EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = s.relid AND d.deptype = 'e') AS ext_owned,
         EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.contype = 'f' AND c.conrelid = s.relid
                    AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey) AS backs_fk,
         pg_relation_size(s.indexrelid) AS bytes
    FROM pg_stat_all_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
   WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
     AND s.schemaname NOT LIKE 'pg_toast%' AND s.schemaname NOT LIKE 'pg_temp%')
  SELECT string_agg(format('%s.%s(%s)', tname, iname, pg_size_pretty(bytes)), ', ' ORDER BY bytes DESC)
    INTO names
    FROM _ix
   WHERE sch = 'public' AND scans = 0 AND NOT uniq AND NOT pk AND NOT ext_owned AND NOT backs_fk;

  RAISE NOTICE E'C-2 UNUSED-INDEX METHODS (lane %, statistics window % days since %):\n  M1 public all=%  M2 public non-PK/unique=%  M3 all-schemas all=%  M4 all-schemas non-PK/unique=%  M5 denominator=%\n  L  Supabase linter rule=%\n  P  proposed (L ∩ public, minus FK-backing)=%  — judged only if window ≥ 14 days: %\n  P candidates: %',
    current_setting('p32.lane'), window_days, coalesce(reset_at::text, 'postmaster start'),
    m1, m2, m3, m4, m5, l, p, CASE WHEN window_days >= 14 THEN 'yes' ELSE 'NO (window too short — not a drop list)' END,
    coalesce(names, 'none');
END
$probe$;

ROLLBACK;
