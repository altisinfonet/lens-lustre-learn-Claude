-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P28 · no table has more index than heap without a written reason — LIVE half.
-- READ-ONLY. Ends in ROLLBACK. Rule: docs/evidence/d1/P28/index-ratio-rule.md.
-- Judges public tables with heap ≥ 1 MB (§2). The reasoned list below must equal
-- scripts/db-p28-index-ratio-reasons.json (the build check compares them); the
-- reasons themselves live in that file.
-- Raises on: (a) a judged table with index > heap that is not reasoned;
--            (b) a reasoned table that no longer exceeds its heap (stale reason).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  reasoned text[] := ARRAY['public.posts']::text[]; -- P28-REASONED
  floor_b  bigint := 1048576;
  bad text; stale text; seen text;
BEGIN
  WITH t AS (
    SELECT n.nspname || '.' || c.relname AS tbl, pg_table_size(c.oid) AS heap, pg_indexes_size(c.oid) AS idx
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))
  SELECT string_agg(tbl || ' (heap ' || pg_size_pretty(heap) || ', index ' || pg_size_pretty(idx) || ')', ', ')
           FILTER (WHERE heap >= floor_b AND idx > heap AND NOT tbl = ANY (reasoned)),
         string_agg(tbl, ', ') FILTER (WHERE tbl = ANY (reasoned) AND NOT (heap >= floor_b AND idx > heap)),
         string_agg(tbl || ' ' || round(idx::numeric / nullif(heap, 0), 2), ', ') FILTER (WHERE heap >= floor_b)
    INTO bad, stale, seen FROM t;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P28: more index than heap, no written reason: %', bad;
  END IF;
  IF stale IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P28: reason no longer needed (remove it from the reasons file and this list): %', stale;
  END IF;
  RAISE NOTICE 'PROBE PASS P28: every table with heap ≥ 1 MB has index ≤ heap or a written reason (index/heap: %)', coalesce(seen, 'none ≥ 1 MB');
END
$probe$;
ROLLBACK;
