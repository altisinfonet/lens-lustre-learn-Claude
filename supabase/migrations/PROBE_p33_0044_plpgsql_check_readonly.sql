-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE for 20260910_0044 — READ-ONLY. WRITES NOTHING, CHANGES NOTHING.
--
-- 0044 is production-only, and production is the lane no session can read.
-- Two facts the migration depends on were not in the Owner's 2026-09-25
-- reading: plpgsql_check's installed VERSION on production, and whether
-- anything there calls or depends on its functions. This file asks exactly
-- those questions, the same way 0044's own preconditions ask them, and
-- returns ONE row whose `verdict` column predicts what a dispatch of 0044
-- would do. Run it BEFORE 0044 to decide whether to dispatch, and AFTER it to
-- verify the move. Either lane, any number of times.
--
-- Its predictions are checked against the real migration on four fixtures
-- in docs/evidence/d1/phase1/p33-0044-run-tests.sh (step 9): if the probe and
-- the file ever disagree, that harness fails.
--
-- The `PROBE_` prefix follows the convention in this directory: not part of
-- the migration sequence.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

WITH ext AS (
  SELECT e.oid, e.extversion, e.extnamespace::regnamespace::text AS nsp,
         pg_get_userbyid(e.extowner) AS owner, e.extrelocatable
    FROM pg_extension e WHERE e.extname = 'plpgsql_check'
), members AS (
  SELECT p.oid, p.proname, p.pronamespace::regnamespace::text AS nsp, p.proacl
    FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid, ext
   WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass
     AND d.refobjid = ext.oid AND d.deptype = 'e'
), rx AS (
  SELECT '\m(' || string_agg(DISTINCT proname, '|') || ')\M' AS member_rx FROM members
), deps AS (          -- 0044 precondition 4
  SELECT DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid) AS what
    FROM pg_depend d, ext
   WHERE d.deptype IN ('n', 'a')
     AND ( (d.refclassid = 'pg_extension'::regclass AND d.refobjid = ext.oid)
        OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid IN (SELECT oid FROM members)) )
     AND NOT EXISTS (SELECT 1 FROM pg_depend m
                      WHERE m.classid = d.classid AND m.objid = d.objid
                        AND m.refclassid = 'pg_extension'::regclass
                        AND m.refobjid = ext.oid AND m.deptype = 'e')
), callers AS (       -- 0044 precondition 5
  SELECT n.nspname || '.' || p.proname AS what
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, rx
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND (p.prosrc ~* rx.member_rx OR p.prosrc ILIKE '%plpgsql_check%')
     AND p.oid NOT IN (SELECT oid FROM members)
), cron_hits AS (     -- 0044 precondition 7. cron.job may not exist on a given
                      -- database; query_to_xml runs the count only when it does,
                      -- so the probe stays one plain read-only statement.
  SELECT CASE WHEN to_regclass('cron.job') IS NULL THEN 0
              ELSE (xpath('/table/row/n/text()', query_to_xml(format(
                     'SELECT count(*) AS n FROM cron.job WHERE command ~* %L OR command ILIKE %L',
                     (SELECT member_rx FROM rx), '%plpgsql_check%'), false, false, '')))[1]::text::int
         END AS n
), priv AS (          -- 0044 precondition 3
  SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super,
         pg_has_role(current_user, (SELECT owner FROM ext), 'MEMBER') AS is_member,
         'plpgsql_check' = ANY (string_to_array(replace(coalesce(
            current_setting('supautils.privileged_extensions', true), ''), ' ', ''), ',')) AS delegated,
         coalesce(current_setting('supautils.privileged_extensions_superuser', true), '') AS delegate_to
), avail AS (
  SELECT default_version FROM pg_available_extensions WHERE name = 'plpgsql_check'
)
SELECT
  current_database()                                                   AS database,
  current_user                                                         AS connected_as,
  now()                                                                AS probe_ran_at,
  (SELECT extversion FROM ext)                                         AS installed_version,
  (SELECT default_version FROM avail)                                  AS image_default_version,
  (SELECT nsp FROM ext)                                                AS extension_schema,
  (SELECT owner FROM ext)                                              AS extension_owner,
  (SELECT count(*) FROM members)                                       AS member_functions,
  (SELECT count(*) FROM members WHERE nsp = 'public')                  AS members_in_public,
  (SELECT count(*) FROM members WHERE has_function_privilege('anon', oid, 'EXECUTE')) AS members_anon_executable,
  (SELECT string_agg(DISTINCT coalesce(proacl::text, 'NULL'), ' | ') FROM members) AS member_acls,
  (SELECT count(*) FROM deps)                                          AS dependents,
  (SELECT string_agg(what, '; ') FROM deps)                            AS dependents_list,
  (SELECT count(*) FROM callers)                                       AS callers,
  (SELECT string_agg(what, ', ') FROM callers)                         AS callers_list,
  (SELECT n FROM cron_hits)                                            AS cron_jobs_calling,
  (SELECT is_super FROM priv)                                          AS connected_as_superuser,
  (SELECT delegated FROM priv)                                         AS supautils_delegates_it,
  CASE
    WHEN (SELECT oid FROM ext) IS NULL                     THEN 'NOT INSTALLED — 0044 would refuse (PRE-001)'
    WHEN (SELECT nsp FROM ext) = 'extensions'              THEN 'ALREADY IN extensions — 0044 would refuse (PRE-002); if 0044 ran, this is its verified end state'
    WHEN (SELECT nsp FROM ext) <> 'public'                 THEN 'IN SCHEMA ' || (SELECT nsp FROM ext) || ' — 0044 would refuse (PRE-002)'
    WHEN NOT ((SELECT is_super FROM priv) OR (SELECT is_member FROM priv)
              OR ((SELECT delegated FROM priv) AND (SELECT delegate_to FROM priv) <> ''))
                                                            THEN 'NO PRIVILEGE PATH — 0044 would refuse (PRE-004)'
    WHEN (SELECT count(*) FROM deps) > 0                   THEN 'DEPENDENTS — 0044 would refuse (PRE-005)'
    WHEN (SELECT count(*) FROM callers) > 0                THEN 'CALLERS — 0044 would refuse (PRE-006)'
    -- NULL here means the count could not be read. It is NOT a zero: the first
    -- draft's xpath returned NULL on a real cron.job and the verdict fell
    -- through to CLEAR. Unknown is now its own verdict.
    WHEN (SELECT n FROM cron_hits) IS NULL                 THEN 'UNKNOWN — cron.job exists but could not be counted; do not dispatch on this probe'
    WHEN (SELECT n FROM cron_hits) > 0                     THEN 'CRON — 0044 would refuse (PRE-007)'
    WHEN (SELECT extversion FROM ext) IS DISTINCT FROM (SELECT default_version FROM avail)
                                                            THEN 'VERSION DRIFT — 0044 would pass its preconditions and then refuse at POST-003 ('
                                                                 || (SELECT extversion FROM ext) || ' installed, image default '
                                                                 || (SELECT default_version FROM avail) || '). Nothing would change.'
    ELSE 'CLEAR — 0044 would move plpgsql_check ' || (SELECT extversion FROM ext) || ' to extensions'
  END                                                                  AS verdict;

COMMIT;
