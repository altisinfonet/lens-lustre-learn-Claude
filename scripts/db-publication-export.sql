-- ═══════════════════════════════════════════════════════════════════════════
-- P3 · the publication READING — input of scripts/db-publication-export.mjs.
-- READ-ONLY (BEGIN READ ONLY … ROLLBACK). Returns ONE row, ONE column: a JSON
-- document. Run it on a lane (SQL editor or psql), save the value as
--   docs/evidence/d1/phase3/readings/publication-<lane>-<yyyymmdd>.json
-- then: node scripts/db-publication-export.mjs --reading <that file> --lane <lane>
-- It reads catalog metadata only — no row of any table, no secret.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'reading',       'db-publication-reading',
  'publication',   p.pubname,
  'readAtUtc',     to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database',      current_database(),
  'serverVersion', current_setting('server_version'),
  'allTables',     p.puballtables,
  'operations',    jsonb_build_object('insert', p.pubinsert, 'update', p.pubupdate, 'delete', p.pubdelete, 'truncate', p.pubtruncate),
  'viaRoot',       p.pubviaroot,
  'tables', coalesce((
     SELECT jsonb_agg(jsonb_build_object(
              'schema', pt.schemaname, 'table', pt.tablename,
              'replicaIdentity', c.relreplident::text,
              'rowFilter', pt.rowfilter,
              'columns', to_jsonb(pt.attnames))
            ORDER BY pt.schemaname, pt.tablename)
       FROM pg_publication_tables pt
       JOIN pg_class c ON c.oid = format('%I.%I', pt.schemaname, pt.tablename)::regclass
      WHERE pt.pubname = p.pubname), '[]'::jsonb)
) AS reading
FROM pg_publication p
WHERE p.pubname = 'supabase_realtime';
ROLLBACK;
