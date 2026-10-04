-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P35 · primary keys and foreign-key indexes — LIVE half. READ-ONLY.
-- Raises (fails the dispatch) on:
--   (a) a public table with no primary key that is not in the reasoned list;
--   (b) a reasoned table that now has a primary key, or no longer exists (stale);
--   (c) a public foreign key with no index whose leading columns are its columns.
-- REASONS (no PK), staging read-only 2026-10-04 08:20 UTC — all six are frozen
-- copies or RETIRED tables; their physical DROP is A-4c (1-AU-03), so a key now
-- would be work on a table that is about to go:
--   _v3_preflight_snapshot_competition_entries / _judge_decisions /
--   _judge_tag_assignments / _judging_tags — "v3 preflight snapshot — frozen copy
--     for rollback. Step 0.1." (table comment); 0–8 kB each.
--   categories_migration_dropped — RETIRED (P33, 2026-09-15), all grants revoked.
--   posts_dead_host_backup_20260812 — RETIRED (P33), service_role only (orphan detector).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  reasoned text[] := ARRAY['_v3_preflight_snapshot_competition_entries', '_v3_preflight_snapshot_judge_decisions',
                           '_v3_preflight_snapshot_judge_tag_assignments', '_v3_preflight_snapshot_judging_tags',
                           'categories_migration_dropped', 'posts_dead_host_backup_20260812']::text[];
  nopk text; stale text; fk text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO nopk
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conrelid = c.oid AND x.contype = 'p')
     AND NOT c.relname = ANY (reasoned);
  SELECT string_agg(r, ', ') INTO stale FROM unnest(reasoned) r
   WHERE to_regclass('public.' || quote_ident(r)) IS NULL
      OR EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conrelid = to_regclass('public.' || quote_ident(r)) AND x.contype = 'p');
  SELECT string_agg(c.conrelid::regclass::text || '(' ||
           (SELECT string_agg(a.attname, ',' ORDER BY k.o) FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) || ')', ', ') INTO fk
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                       AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
                       AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey);
  IF nopk IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL P35: table(s) with no primary key and no written reason: %', nopk; END IF;
  IF stale IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL P35: reason no longer needed (table gone or keyed): %', stale; END IF;
  IF fk IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL P35: foreign key(s) with no leading index: %', fk; END IF;
  RAISE NOTICE 'PROBE PASS P35: every public table has a primary key or a written reason; every foreign key is indexed';
END
$probe$;
ROLLBACK;
