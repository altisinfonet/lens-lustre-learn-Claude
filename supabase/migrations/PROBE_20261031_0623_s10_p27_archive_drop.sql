-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0623 · S10 P27 archive-and-drop. READ ONLY, ROLLBACK.
-- FAIL before the apply (the tables are still in public), PASS after:
--   G1  public.wallet_ledger_v2_diff_log / v3_mirror_log / wallet_ledger_v2_rows gone
--   G2  p27_archive.manifest: 3 tables, all verified; each archive copy still
--       has the manifest's row count and md5 (the copy has not drifted)
--   G3  no function body and no view in any non-system schema names the tables
--   G4  the judging mirror trigger is attached to judge_tag_assignments and enabled
--   G5  no cron job named wallet_ledger_v2_diff_hourly
--   G6  anon / authenticated / service_role have no USAGE on p27_archive
--   G7  p27_archive.ddl holds rebuild statements for all 3 tables and phase 3
-- Prints counts and object names only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $probe$
DECLARE
  r record; bad text; n bigint; md text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  SELECT string_agg(t, ', ') INTO bad FROM unnest(ARRAY['wallet_ledger_v2_diff_log', 'v3_mirror_log', 'wallet_ledger_v2_rows']) t
   WHERE to_regclass('public.' || t) IS NOT NULL;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0623 G1: still in public: %', bad; END IF;

  IF to_regclass('p27_archive.manifest') IS NULL THEN RAISE EXCEPTION 'PROBE FAIL 0623 G2: p27_archive.manifest missing'; END IF;
  SELECT count(*) INTO n FROM p27_archive.manifest WHERE verified;
  IF n <> 3 THEN RAISE EXCEPTION 'PROBE FAIL 0623 G2: % verified tables in the manifest, want 3', n; END IF;
  FOR r IN SELECT * FROM p27_archive.manifest ORDER BY table_name LOOP
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(x::text, E''\n'' ORDER BY x::text), '''')) FROM p27_archive.%I x', r.table_name)
      INTO n, md;
    IF n <> r.row_count OR md <> r.rows_md5 THEN
      RAISE EXCEPTION 'PROBE FAIL 0623 G2: archive copy of % drifted (rows % vs %)', r.table_name, n, r.row_count;
    END IF;
    RAISE NOTICE '0623|archive|%|rows=%|md5=%|archived_at=%', r.table_name, r.row_count, r.rows_md5, date_trunc('second', r.archived_at);
  END LOOP;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0623 G3: function bodies name a dropped table: %', bad; END IF;
  SELECT string_agg(v.oid::regclass::text, ', ') INTO bad FROM pg_class v
   WHERE v.relkind IN ('v', 'm') AND pg_get_viewdef(v.oid) ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0623 G3: views name a dropped table: %', bad; END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.judge_tag_assignments'::regclass AND tgfoid = 'public.mirror_system_tag_to_decision()'::regprocedure
     AND NOT tgisinternal AND tgenabled <> 'D';
  IF n < 1 THEN RAISE EXCEPTION 'PROBE FAIL 0623 G4: the judging mirror trigger is not attached and enabled'; END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE jobname = 'wallet_ledger_v2_diff_hourly'$q$ INTO n;
    IF n > 0 THEN RAISE EXCEPTION 'PROBE FAIL 0623 G5: cron job wallet_ledger_v2_diff_hourly still scheduled'; END IF;
  END IF;

  IF has_schema_privilege('anon', 'p27_archive', 'USAGE') OR has_schema_privilege('authenticated', 'p27_archive', 'USAGE')
     OR has_schema_privilege('service_role', 'p27_archive', 'USAGE') THEN
    RAISE EXCEPTION 'PROBE FAIL 0623 G6: an API role can use schema p27_archive';
  END IF;

  FOR r IN SELECT phase, count(*) c, count(DISTINCT obj) o FROM p27_archive.ddl GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE '0623|ddl|phase %|statements=%|objects=%', r.phase, r.c, r.o;
  END LOOP;
  SELECT count(DISTINCT obj) INTO n FROM p27_archive.ddl WHERE phase = 2;
  IF n <> 3 OR NOT EXISTS (SELECT 1 FROM p27_archive.ddl WHERE phase = 3) THEN
    RAISE EXCEPTION 'PROBE FAIL 0623 G7: rebuild statements incomplete (phase-2 tables %, phase 3 present %)',
      n, EXISTS (SELECT 1 FROM p27_archive.ddl WHERE phase = 3);
  END IF;

  RAISE NOTICE 'PROBE PASS 0623 — 3 tables archived (copies unchanged) and dropped; nothing names them; mirror trigger attached; archive private';
END
$probe$;

ROLLBACK;
