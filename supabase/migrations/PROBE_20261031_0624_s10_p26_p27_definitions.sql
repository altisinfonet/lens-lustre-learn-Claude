-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 P26 + P27 · print the live DEFINITIONS that the P26 / P27 changes
-- must be written against. READ ONLY, ROLLBACK. Never fails on findings.
--
-- PROBE 0622 found that the live body of mirror_system_tag_to_decision() on
-- staging matches no version in git (md5 7538b274…, 8,202 chars), so the P27
-- rewrite cannot be taken from the repository. This prints, for each object,
-- its md5 and its full definition (code and catalog text only; no row data):
--   functions whose body names a P27 table or db_audit_logs and that are
--   trigger functions or one of the P27 readers/writers; the v_judging_drift
--   view (with reloptions); every trigger that calls those functions.
-- Each definition is printed one source line per NOTICE, prefixed with the
-- object and a line number, so the text can be rebuilt exactly from the log.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $probe$
DECLARE
  r record; ln text; i int; def text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  RAISE NOTICE 'P0624|lane=%|at=%', current_setting('p32.lane'), date_trunc('second', now());

  FOR r IN SELECT p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
                  md5(p.prosrc) AS m, length(p.prosrc) AS len
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND (p.prosrc ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)'
                   OR (p.prorettype = 'trigger'::regtype AND p.prosrc ~ 'db_audit_logs'))
            ORDER BY 2 LOOP
    def := pg_get_functiondef(r.oid);
    RAISE NOTICE 'DEF|BEGIN|fn|%|prosrc_md5=%|prosrc_len=%|def_md5=%', r.sig, r.m, r.len, md5(def);
    i := 0;
    FOREACH ln IN ARRAY string_to_array(def, E'\n') LOOP
      i := i + 1;
      RAISE NOTICE 'DEF|%|%|%', r.sig, lpad(i::text, 4, '0'), ln;
    END LOOP;
    RAISE NOTICE 'DEF|END|fn|%|lines=%', r.sig, i;
  END LOOP;

  IF to_regclass('public.v_judging_drift') IS NOT NULL THEN
    SELECT pg_get_viewdef('public.v_judging_drift'::regclass) INTO def;
    RAISE NOTICE 'DEF|BEGIN|view|public.v_judging_drift|md5=%|reloptions=%|owner=%', md5(def),
      (SELECT coalesce(array_to_string(reloptions, ','), '-') FROM pg_class WHERE oid = 'public.v_judging_drift'::regclass),
      (SELECT relowner::regrole FROM pg_class WHERE oid = 'public.v_judging_drift'::regclass);
    i := 0;
    FOREACH ln IN ARRAY string_to_array(def, E'\n') LOOP
      i := i + 1;
      RAISE NOTICE 'DEF|public.v_judging_drift|%|%', lpad(i::text, 4, '0'), ln;
    END LOOP;
    RAISE NOTICE 'DEF|END|view|public.v_judging_drift|lines=%', i;
  END IF;

  FOR r IN SELECT tg.tgname, tg.tgrelid::regclass AS tbl, pg_get_triggerdef(tg.oid) AS d
             FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE NOT tg.tgisinternal
              AND (p.prosrc ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)' OR p.prosrc ~ 'db_audit_logs')
            ORDER BY 2::text, 1 LOOP
    RAISE NOTICE 'TRG|%|%|enabled=%|%', r.tbl, r.tgname,
      (SELECT tgenabled FROM pg_trigger WHERE tgname = r.tgname AND tgrelid = r.tbl), r.d;
  END LOOP;

  RAISE NOTICE 'P0624|done';
END
$probe$;

ROLLBACK;
