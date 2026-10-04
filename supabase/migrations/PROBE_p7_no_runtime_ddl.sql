-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P7 · no schema-cache reload outside a deployment — the LIVE half.
-- READ-ONLY. Ends in ROLLBACK. Raises (and so fails the dispatch) on a hit.
--
-- scripts/db-p7-runtime-ddl-check.mjs is the build-time half: it judges every
-- function, procedure and cron job that git defines. This probe judges what the
-- database actually holds, including objects git never created (on staging,
-- 2026-10-04, 24 live public functions appear in no applied migration — they
-- came from outside git). Same three rules, same pgrst lists:
--   A · a public function/procedure body or a cron.job command contains a
--       statement on the pgrst_ddl_watch / pgrst_drop_watch lists against a
--       non-temporary object (CREATE TEMP/TEMPORARY TABLE and pg_temp.* exempt);
--   B · EXECUTE with a literal that starts with one of those statements;
--   C · NOTIFY pgrst / pg_notify('pgrst', …).
-- Bodies are scanned after removing -- comments and blanking '…' literals for
-- rule A, so the word "comment on a post" in a message string is not a hit.
-- Functions that belong to an extension are not judged (not ours to change).
-- Allowed exceptions: none today. An exception is added here, by name, with its
-- written reason, in the same PR as the function — never silently.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  ddl  text := '(create\s+(or\s+replace\s+)?(schema|table|unlogged\s+table|foreign\s+table|view|materialized\s+view|function|procedure|trigger|type|rule)'
            || '|alter\s+(schema|table|foreign\s+table|view|materialized\s+view|function|type)'
            || '|drop\s+(schema|table|foreign\s+table|view|materialized\s+view|function|procedure|trigger|type|rule)'
            || '|comment\s+on)\M';
  r    record;
  hits text := '';
  n    int := 0;
  code text;
  bare text;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS id, p.prosrc AS body
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'cron:' || jobname, command FROM cron.job
  LOOP
    code := regexp_replace(r.body, '--[^\n]*', '', 'g');
    bare := regexp_replace(code, '''([^'']|'''')*''', '''''', 'g');
    -- A: static DDL on a non-temp object
    IF bare ~* ('(^|[;\s(])' || ddl)
       AND regexp_replace(bare, '(?i)create\s+(or\s+replace\s+)?(temp|temporary)\s+table|(table|view)\s+(if\s+(not\s+)?exists\s+)?pg_temp\.', '', 'g') ~* ('(^|[;\s(])' || ddl) THEN
      hits := hits || E'\n  A ' || r.id; n := n + 1;
    END IF;
    -- B: dynamic DDL in a literal handed to EXECUTE
    IF bare ~* '\mexecute\M' AND code ~* ('''\s*' || ddl) AND code !~* '''\s*create\s+(temp|temporary)\s+table' THEN
      hits := hits || E'\n  B ' || r.id; n := n + 1;
    END IF;
    -- C: the reload itself
    IF bare ~* '\mnotify\s+pgrst\M' OR code ~* 'pg_notify\s*\(\s*''pgrst''' THEN
      hits := hits || E'\n  C ' || r.id; n := n + 1;
    END IF;
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL P7: % runtime schema-reload trigger(s):%', n, hits;
  END IF;
  RAISE NOTICE 'PROBE PASS P7: no public function, procedure or cron job runs reload-triggering DDL at runtime';
END
$probe$;
ROLLBACK;
