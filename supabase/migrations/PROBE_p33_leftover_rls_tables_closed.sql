-- ═══════════════════════════════════════════════════════════════════════════
-- P33 GATE PROBE — the two leftover RLS-enabled tables are retired. READS ONLY.
--
-- The `PROBE_` prefix follows PROBE_p30_email_exists_closed.sql: not part of
-- the ordered migration sequence, dispatched through apply-migration.yml like
-- any other reviewed file, safe on either lane, any number of times. It ends
-- in ROLLBACK.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE
--
-- `docs/gates/GATE_REGISTER.md` P33 (verbatim, clause 3): "...the two leftover
-- RLS-enabled tables retired..." — proved per table, by RLS still enabled AND
-- anon/authenticated holding no privilege, on the lane it runs.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the catalogue. It does not call
-- PostgREST as an anonymous browser would, and it does not re-prove that RLS
-- with zero policies actually denies a row — that property of Postgres is
-- exercised on a fixture in docs/evidence/d1/P33/, not against a lane (F-65).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  r RECORD;
  fail_count integer := 0;
BEGIN
  RAISE NOTICE '--- P33 gate probe: leftover RLS tables @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %  (current_database)', current_database();

  FOR r IN
    SELECT t.relname,
           t.relrowsecurity,
           (SELECT count(*) FROM pg_policies pol WHERE pol.schemaname='public' AND pol.tablename=t.relname) AS policy_count,
           has_table_privilege('anon', t.oid, 'SELECT')          AS anon_select,
           has_table_privilege('anon', t.oid, 'INSERT')          AS anon_insert,
           has_table_privilege('authenticated', t.oid, 'SELECT') AS auth_select,
           has_table_privilege('authenticated', t.oid, 'INSERT') AS auth_insert,
           t.relacl::text AS acl
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
     WHERE t.relname IN ('categories_migration_dropped', 'posts_dead_host_backup_20260812')
  LOOP
    IF NOT r.relrowsecurity THEN
      fail_count := fail_count + 1;
      RAISE WARNING 'FAILED — %: RLS is not enabled (relrowsecurity=false). The gate requires RLS enabled; something disabled it.', r.relname;
    END IF;

    IF r.anon_select OR r.anon_insert THEN
      fail_count := fail_count + 1;
      RAISE WARNING 'FAILED — %: anon can still SELECT (%) or INSERT (%). acl=%', r.relname, r.anon_select, r.anon_insert, COALESCE(r.acl, 'NULL');
    END IF;

    IF r.auth_select OR r.auth_insert THEN
      fail_count := fail_count + 1;
      RAISE WARNING 'FAILED — %: authenticated can still SELECT (%) or INSERT (%). acl=%', r.relname, r.auth_select, r.auth_insert, COALESCE(r.acl, 'NULL');
    END IF;

    RAISE NOTICE '% .... rls=%  policies=%  anon(select=%,insert=%)  authenticated(select=%,insert=%)  acl=%',
      rpad(r.relname, 34), r.relrowsecurity, r.policy_count, r.anon_select, r.anon_insert, r.auth_select, r.auth_insert, COALESCE(r.acl, 'NULL');
  END LOOP;

  -- posts_dead_host_backup_20260812 must keep service_role — detect-orphan-files depends on it.
  IF NOT has_table_privilege('service_role', 'public.posts_dead_host_backup_20260812'::regclass, 'SELECT') THEN
    fail_count := fail_count + 1;
    RAISE WARNING 'FAILED — posts_dead_host_backup_20260812: service_role lost SELECT. supabase/functions/detect-orphan-files/index.ts reads this table with service_role; this is an over-revoke, not the gate.';
  ELSE
    RAISE NOTICE 'service_role retains SELECT on posts_dead_host_backup_20260812 (detect-orphan-files dependency) .. PASS';
  END IF;

  IF fail_count > 0 THEN
    RAISE EXCEPTION '--- % ASSERTION(S) FAILED. P33 clause 3 does not hold on this lane. ---', fail_count;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED. P33 clause 3 (leftover RLS tables retired) holds on this lane. Nothing was written. ---';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
