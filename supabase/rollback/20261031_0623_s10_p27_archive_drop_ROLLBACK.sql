-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0623 — S10 P27. Rebuilds the three dropped tables from
-- their verified copies in p27_archive and replays every statement 0623 saved
-- in p27_archive.ddl, in order:
--   per table: CREATE TABLE (LIKE the archive copy, which carries columns,
--   NOT NULL, CHECK, comments, storage) → phase 1 (sequences, defaults) →
--   rows back → md5 must equal the manifest → phase 2 (keys, indexes, RLS,
--   policies, grants, triggers, comments, publications, sequence position);
--   then phase 3: the original function bodies (CREATE OR REPLACE; the two
--   dropped diff functions come back), their grants and comments, the original
--   view, the cron job.
-- ONE TRANSACTION. Leaves p27_archive in place (drop it by hand only after the
-- Owner says the copy is no longer wanted). Refuses if a table already exists.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $rb$
DECLARE
  m record; d record; n bigint; md text;
BEGIN
  IF to_regclass('p27_archive.manifest') IS NULL OR to_regclass('p27_archive.ddl') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED 0623 — p27_archive.manifest / ddl missing (0623 never applied here?)';
  END IF;
  IF (SELECT count(*) FROM p27_archive.manifest WHERE verified) <> 3 THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED 0623 — manifest does not hold 3 verified tables';
  END IF;

  FOR m IN SELECT * FROM p27_archive.manifest ORDER BY table_name LOOP
    IF to_regclass('public.' || m.table_name) IS NOT NULL THEN
      RAISE EXCEPTION 'ROLLBACK REFUSED 0623 — public.% already exists', m.table_name;
    END IF;
    EXECUTE format('CREATE TABLE public.%I (LIKE p27_archive.%I INCLUDING ALL)', m.table_name, m.table_name);
    FOR d IN SELECT stmt FROM p27_archive.ddl WHERE phase = 1 AND obj = m.table_name ORDER BY seq LOOP
      EXECUTE d.stmt;
    END LOOP;
    EXECUTE format('INSERT INTO public.%I SELECT * FROM p27_archive.%I', m.table_name, m.table_name);
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(x::text, E''\n'' ORDER BY x::text), '''')) FROM public.%I x', m.table_name)
      INTO n, md;
    IF n <> m.row_count OR md <> m.rows_md5 THEN
      RAISE EXCEPTION 'ROLLBACK FAILED 0623 — restored % does not match the manifest (rows % vs %, md5 % vs %)',
        m.table_name, n, m.row_count, md, m.rows_md5;
    END IF;
    -- foreign keys wait until all three tables are back (one may point at another)
    FOR d IN SELECT stmt FROM p27_archive.ddl WHERE phase = 2 AND obj = m.table_name AND stmt !~* 'FOREIGN KEY' ORDER BY seq LOOP
      EXECUTE d.stmt;
    END LOOP;
    RAISE NOTICE 'ROLLBACK 0623|public.% restored|rows=%|md5 matches manifest', m.table_name, n;
  END LOOP;
  FOR d IN SELECT stmt FROM p27_archive.ddl WHERE phase = 2 AND stmt ~* 'FOREIGN KEY' ORDER BY seq LOOP
    EXECUTE d.stmt;
  END LOOP;

  FOR d IN SELECT obj, stmt FROM p27_archive.ddl WHERE phase = 3 ORDER BY seq LOOP
    EXECUTE d.stmt;
  END LOOP;
END
$rb$;

DO $post$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM unnest(ARRAY['wallet_ledger_v2_diff_log', 'v3_mirror_log', 'wallet_ledger_v2_rows']) t
   WHERE to_regclass('public.' || t) IS NOT NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'ROLLBACK FAILED 0623 — % of 3 tables back', n; END IF;
  IF pg_get_viewdef('public.v_judging_drift'::regclass) !~ 'v3_mirror_log' THEN
    RAISE EXCEPTION 'ROLLBACK FAILED 0623 — v_judging_drift was not restored';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.mirror_system_tag_to_decision()'::regprocedure) !~ 'v3_mirror_log' THEN
    RAISE EXCEPTION 'ROLLBACK FAILED 0623 — the original mirror trigger body was not restored';
  END IF;
  RAISE NOTICE 'ROLLBACK 0623 POST PASS — 3 tables, original functions, view and cron job restored';
END
$post$;

COMMIT;
