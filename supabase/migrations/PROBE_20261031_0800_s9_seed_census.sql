-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S9 · seed census: baseline counts + seeded residue. Owner item 20
-- (2026-10-31 09:05 UTC, #553): the 1 M seeder may run on staging only, and
-- afterwards every seeded row must be gone everywhere, proven by a PROBE —
-- 0 seeded rows, counts back to the baseline recorded before seeding.
--
-- Run it (1) on staging BEFORE seeding: it records the baseline (C and K
-- lines) and must PASS (no residue); (2) after the teardown: it must PASS and
-- its C/K lines are compared with (1); (3) on production at any time: proves
-- nothing seeded is there.
--
--   C  exact row count of every table in public, pgmq, storage, auth
--      (partition parents only, so nothing is counted twice)
--   K  sum of every integer counter column in public (name *_count / *_counter)
--   R  seeded residue, by the seeder's own key (scripts/db-seed-staging.mjs,
--      namespace 50mm-seed-v1, id = md5('50mm-seed-v1:post:' || n)::uuid,
--      n = 1 .. 1,000,000):
--        R1 every uuid column in public / pgmq whose name can hold a post id
--           (…post_id, reference_id, entity_id, target_id, source_id,
--           object_id, item_id, subject_id, parent_id, related_id, and
--           posts.id itself)
--        R2 every jsonb column in pgmq, and public jsonb columns named
--           message / payload / data / metadata / details / old_data /
--           new_data / extra: ->> post_id / reference_id / entity_id / id
--        R3 every text column in public named content / body / message /
--           title / text / caption / preview / description / summary that
--           contains the seed marker '[seed 50mm-seed-v1]'
--   FAIL if any R count is above 0.
-- Writes only a temporary table of the seeded ids; ends in ROLLBACK.
-- Prints table / column names, counts and sums only — never row data.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '900s';

DO $guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
END
$guard$;

CREATE TEMP TABLE s9_seed_ids ON COMMIT DROP AS
  SELECT md5('50mm-seed-v1:post:' || g)::uuid AS id, md5('50mm-seed-v1:post:' || g)::uuid::text AS id_text
    FROM generate_series(1, 1000000) g;
CREATE UNIQUE INDEX ON s9_seed_ids (id);
CREATE UNIQUE INDEX ON s9_seed_ids (id_text);
ANALYZE s9_seed_ids;

DO $probe$
DECLARE
  r record; n bigint; s numeric; resid bigint := 0; cols int := 0; tabs int := 0;
BEGIN
  RAISE NOTICE 'S9C|lane=%|at=%', current_setting('p32.lane'), date_trunc('second', now());

  -- C: exact counts
  FOR r IN SELECT c.oid::regclass AS rel, n.nspname, c.relname
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND n.nspname IN ('public', 'pgmq', 'storage', 'auth')
            ORDER BY 2, 3 LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.rel) INTO n;
    tabs := tabs + 1;
    RAISE NOTICE 'S9C|C|%.%|rows=%', r.nspname, r.relname, n;
  END LOOP;

  -- K: counter sums
  FOR r IN SELECT a.attrelid::regclass AS rel, c.relname, a.attname
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND a.attnum > 0 AND NOT a.attisdropped
              AND a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype, 'numeric'::regtype)
              AND a.attname ~ '(_count|_counter)$'
            ORDER BY 2, 3 LOOP
    EXECUTE format('SELECT coalesce(sum(%I), 0) FROM %s', r.attname, r.rel) INTO s;
    RAISE NOTICE 'S9C|K|%.%|sum=%', r.relname, r.attname, s;
  END LOOP;

  -- R1: uuid columns that can hold a post id
  FOR r IN SELECT a.attrelid::regclass AS rel, n.nspname, c.relname, a.attname
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('public', 'pgmq') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
              AND (a.attname ~ '(post_id|reference_id|entity_id|target_id|source_id|object_id|item_id|subject_id|parent_id|related_id)$'
                   OR (n.nspname = 'public' AND c.relname = 'posts' AND a.attname = 'id'))
            ORDER BY 2, 3, 4 LOOP
    EXECUTE format('SELECT count(*) FROM %s t WHERE t.%I IN (SELECT id FROM s9_seed_ids)', r.rel, r.attname) INTO n;
    cols := cols + 1;
    IF n > 0 THEN resid := resid + n; RAISE NOTICE 'S9C|R1|%.%.%|seeded=%', r.nspname, r.relname, r.attname, n; END IF;
  END LOOP;

  -- R2: post ids inside jsonb payloads
  FOR r IN SELECT a.attrelid::regclass AS rel, n.nspname, c.relname, a.attname
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'jsonb'::regtype
              AND (n.nspname = 'pgmq'
                   OR (n.nspname = 'public' AND a.attname IN ('message', 'payload', 'data', 'metadata', 'details', 'old_data', 'new_data', 'extra')))
            ORDER BY 2, 3, 4 LOOP
    EXECUTE format($q$SELECT count(*) FROM %s t WHERE jsonb_typeof(t.%I) = 'object' AND (
                        t.%I ->> 'post_id' IN (SELECT id_text FROM s9_seed_ids)
                     OR t.%I ->> 'reference_id' IN (SELECT id_text FROM s9_seed_ids)
                     OR t.%I ->> 'entity_id' IN (SELECT id_text FROM s9_seed_ids)
                     OR t.%I ->> 'id' IN (SELECT id_text FROM s9_seed_ids))$q$,
                   r.rel, r.attname, r.attname, r.attname, r.attname, r.attname) INTO n;
    cols := cols + 1;
    IF n > 0 THEN resid := resid + n; RAISE NOTICE 'S9C|R2|%.%.%|seeded=%', r.nspname, r.relname, r.attname, n; END IF;
  END LOOP;

  -- R3: the seed marker in member-visible text
  FOR r IN SELECT a.attrelid::regclass AS rel, c.relname, a.attname
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
              AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid IN ('text'::regtype, 'varchar'::regtype)
              AND a.attname IN ('content', 'body', 'message', 'title', 'text', 'caption', 'preview', 'description', 'summary')
            ORDER BY 2, 3 LOOP
    EXECUTE format($q$SELECT count(*) FROM %s t WHERE strpos(t.%I, '[seed 50mm-seed-v1]') > 0$q$, r.rel, r.attname) INTO n;
    cols := cols + 1;
    IF n > 0 THEN resid := resid + n; RAISE NOTICE 'S9C|R3|%.%|seeded=%', r.relname, r.attname, n; END IF;
  END LOOP;

  RAISE NOTICE 'S9C|summary|tables=%|residue_columns_checked=%|seeded_rows=%', tabs, cols, resid;
  IF resid > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL 0800 — % seeded row(s) present (lines S9C|R* above)', resid;
  END IF;
  RAISE NOTICE 'PROBE PASS 0800 — 0 seeded rows in % columns checked; baseline counts above', cols;
END
$probe$;

ROLLBACK;
