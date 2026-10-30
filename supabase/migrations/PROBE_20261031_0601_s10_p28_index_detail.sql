-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 P28 · index detail for tables over the index/heap rule
-- READ ONLY, ROLLBACK. Never fails on what it finds (it measures; the gate is
-- PROBE_p28_index_ratio.sql). Prints, for every public table with heap ≥ 1 MB
-- whose indexes are larger than its heap, each index: name, size, scans since
-- the last stats reset, unique/primary, and its column list. Names and sizes
-- only — no row data (the Actions log is public).
--
-- Why: PROBE_p28_index_ratio failed on production 2026-10-30 (run
-- 41049204665): public.email_send_log heap 3128 kB, index 3648 kB, no written
-- reason. A reason (or a drop proposal for A-4c, after the C-2 hold) must rest
-- on measured per-index sizes and use, not on the definitions in git.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  r record;
  line text := '';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  FOR r IN
    WITH t AS (
      SELECT c.oid, n.nspname || '.' || c.relname AS tbl,
             pg_table_size(c.oid) AS heap, pg_indexes_size(c.oid) AS idx
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))
    SELECT t.tbl, pg_size_pretty(t.heap) AS heap, pg_size_pretty(t.idx) AS idx,
           i.indexrelid::regclass::text AS iname,
           pg_size_pretty(pg_relation_size(i.indexrelid)) AS isize,
           coalesce(s.idx_scan, 0) AS scans,
           i.indisunique AS uniq, i.indisprimary AS pk,
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols,
           i.indexprs IS NOT NULL AS expr, i.indpred IS NOT NULL AS partial
      FROM t
      JOIN pg_index i ON i.indrelid = t.oid
      LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
     WHERE t.heap >= 1048576 AND t.idx > t.heap
     ORDER BY t.tbl, pg_relation_size(i.indexrelid) DESC
  LOOP
    line := line || format(E'\n  %s (heap %s, index %s) · %s %s scans=%s unique=%s pk=%s cols=(%s)%s%s',
      r.tbl, r.heap, r.idx, r.iname, r.isize, r.scans, r.uniq, r.pk, coalesce(r.cols, ''),
      CASE WHEN r.expr THEN ' +expr' ELSE '' END, CASE WHEN r.partial THEN ' partial' ELSE '' END);
  END LOOP;

  RAISE NOTICE 'P28 INDEX DETAIL (lane %, stats since %):%',
    current_setting('p32.lane'),
    (SELECT coalesce(stats_reset::text, 'never reset') FROM pg_stat_database WHERE datname = current_database()),
    coalesce(nullif(line, ''), E'\n  (no table over the rule)');
END
$probe$;

ROLLBACK;
