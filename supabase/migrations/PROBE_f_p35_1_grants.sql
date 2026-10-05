-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · F-P35-1 (20261005_0001) — the LIVE half. READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   G1 · each _v3_preflight_snapshot_* table that exists: anon and
--        authenticated hold no privilege; RLS on.
--   G2 · post_comments: anon holds SELECT only; authenticated holds no
--        TRUNCATE / REFERENCES / TRIGGER; RLS on.
--   G3 · reports: anon holds nothing; authenticated as G2; RLS on.
--   G4 · what the app uses is still there: anon SELECT on post_comments;
--        authenticated SELECT/INSERT/UPDATE/DELETE on post_comments and
--        SELECT/INSERT/UPDATE on reports.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  _t    text;
  _p    text;
  hits  text := '';
  n     int := 0;
BEGIN
  FOREACH _t IN ARRAY ARRAY['_v3_preflight_snapshot_competition_entries', '_v3_preflight_snapshot_judge_decisions',
                            '_v3_preflight_snapshot_judge_tag_assignments', '_v3_preflight_snapshot_judging_tags'] LOOP
    IF to_regclass('public.' || _t) IS NOT NULL THEN
      n := n + 1;
      FOREACH _p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege('anon', to_regclass('public.' || _t), _p) THEN hits := hits || E'\n  G1 ' || _t || ': anon ' || _p; END IF;
        IF has_table_privilege('authenticated', to_regclass('public.' || _t), _p) THEN hits := hits || E'\n  G1 ' || _t || ': authenticated ' || _p; END IF;
      END LOOP;
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || _t)) THEN hits := hits || E'\n  G1 ' || _t || ': RLS off'; END IF;
    END IF;
  END LOOP;
  FOREACH _p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.post_comments', _p) THEN hits := hits || E'\n  G2 post_comments: anon ' || _p; END IF;
  END LOOP;
  FOREACH _p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.reports', _p) THEN hits := hits || E'\n  G3 reports: anon ' || _p; END IF;
  END LOOP;
  FOREACH _p IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('authenticated', 'public.post_comments', _p) THEN hits := hits || E'\n  G2 post_comments: authenticated ' || _p; END IF;
    IF has_table_privilege('authenticated', 'public.reports', _p) THEN hits := hits || E'\n  G3 reports: authenticated ' || _p; END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.post_comments'::regclass) THEN hits := hits || E'\n  G2 post_comments: RLS off'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reports'::regclass) THEN hits := hits || E'\n  G3 reports: RLS off'; END IF;
  IF NOT has_table_privilege('anon', 'public.post_comments', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.post_comments', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('authenticated', 'public.reports', 'SELECT,INSERT,UPDATE') THEN
    hits := hits || E'\n  G4 a privilege the app uses is missing';
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL F-P35-1:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS F-P35-1: % snapshot table(s) closed to anon/authenticated; post_comments anon = SELECT only; reports anon = none; no TRUNCATE/REFERENCES/TRIGGER for the API roles', n;
END
$probe$;
ROLLBACK;
