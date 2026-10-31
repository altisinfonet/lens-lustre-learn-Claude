-- ═══════════════════════════════════════════════════════════════════════════
-- 20261031_0623 · S10 P27 · archive, then drop, the three old tables
--   public.wallet_ledger_v2_diff_log   (hourly wallet v2 diff monitor)
--   public.v3_mirror_log               (judging tag→decision mirror log)
--   public.wallet_ledger_v2_rows       (wallet v2 "live path" mirror)
--
-- Owner decision 16, 2026-10-31 08:13 UTC (PR #553): "ARCHIVE AND DROP —
-- archive first (verified copy), then drop; PROBE → apply → PROBE, staging then
-- production." Gate P27: each named table dropped or given a written reason,
-- with a rollback recorded (supabase/rollback/20261031_0623_..._ROLLBACK.sql).
--
-- ONE TRANSACTION. In order:
--   G  refuse unless the lane is asserted, the tables exist, p27_archive does
--      not, and every function / view that names one of the tables is one this
--      file was written against (md5 of its body, measured by PROBE 0622 on
--      both lanes). Nothing else may depend on them (no FK into them).
--   1  p27_archive schema (no grants to anon / authenticated / service_role;
--      not an API schema). p27_archive.ddl holds every statement the rollback
--      needs to rebuild what this file removes: column defaults, sequences,
--      constraints, indexes, RLS, policies, grants, triggers, comments,
--      publications, the original function bodies + their grants, the view,
--      the cron job.
--   2  copy each table into p27_archive.<table> and VERIFY the copy: same row
--      count and the same md5 over every row's text, ordered (manifest).
--   3  stop every writer / reader:
--      - mirror_system_tag_to_decision() (3 triggers on judge_tag_assignments):
--        rebuilt from the LIVE text (not in git) with its 9 log INSERTs removed;
--        same judging writes (judge_decisions, judge_award_tags), same re-raising
--        error handler. WITHOUT this rewrite the drop would make every judge tag
--        write fail (each log INSERT would raise "relation does not exist").
--      - wallet_ledger_apply_v2(): branch F (p_dry_run = false), which only
--        wrote wallet_ledger_v2_rows, now refuses without writing. Every
--        caller is a dry-run shadow; the dry-run path is unchanged.
--      - v_judging_drift: the F4 branch (v3_mirror_log errors) removed; same
--        columns, same reloptions, grants kept by CREATE OR REPLACE.
--      - cron job wallet_ledger_v2_diff_hourly unscheduled; the two v2 diff
--        functions that read the dropped tables are dropped.
--   4  DROP TABLE … RESTRICT (fails if anything still depends on them).
--   P  post-checks: tables gone; no function body or view names them; the
--      trigger is still attached and enabled; manifest verified for all 3;
--      anon / authenticated / service_role cannot reach p27_archive.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- ── G ──────────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  r record; bad text;
  -- (function signature, md5(prosrc)) pairs this file was written against.
  -- Measured by PROBE 0622: staging run 41186134121 (0622) / 41187751185 (0624), production run 41187337459 (0622).
  expected constant text[][] := ARRAY[
    ['public.mirror_system_tag_to_decision()', '7538b274c5f975509b11cb083bca642b'],
    ['public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)', '30cee83de187ba8003a34f7a6839dcd1'],
    ['public.wallet_ledger_v2_diff_snapshot(p_window interval)', 'f96e34b47524731d5a29b7f99753193c'],
    ['public.wallet_ledger_v2_diff_report(p_window interval)', 'b7ceb959b05ff65afde2a52cd00ad05e']
  ];
  ok boolean;
BEGIN
  IF to_regclass('public.wallet_ledger_v2_diff_log') IS NULL
     OR to_regclass('public.v3_mirror_log') IS NULL
     OR to_regclass('public.wallet_ledger_v2_rows') IS NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0623 — one of the three tables is already gone; run the PROBE, do not re-apply';
  END IF;
  IF to_regnamespace('p27_archive') IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0623 — schema p27_archive already exists';
  END IF;

  FOR r IN SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
                  md5(p.prosrc) AS m
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND p.prosrc ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)' LOOP
    ok := false;
    FOR i IN 1 .. array_length(expected, 1) LOOP
      IF expected[i][1] = r.sig AND expected[i][2] = r.m THEN ok := true; END IF;
    END LOOP;
    IF NOT ok THEN
      RAISE EXCEPTION 'APPLY REFUSED 0623 — % (body md5 %) names a P27 table and is not one this file was written against', r.sig, r.m;
    END IF;
  END LOOP;
  -- and the other way round: every function this file replaces or drops must
  -- still be there with exactly the body it was written against. A newer body
  -- that no longer names the tables would otherwise be overwritten silently.
  FOR i IN 1 .. array_length(expected, 1) LOOP
    SELECT md5(p.prosrc) INTO bad
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = expected[i][1];
    IF bad IS DISTINCT FROM expected[i][2] THEN
      RAISE EXCEPTION 'APPLY REFUSED 0623 — % has body md5 %; this file was written against %', expected[i][1], coalesce(bad, '(missing)'), expected[i][2];
    END IF;
  END LOOP;
  bad := NULL;

  -- no cron job other than the one this file unschedules names the tables or the dropped functions
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT string_agg(jobname, ', ') FROM cron.job
                WHERE command ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows|wallet_ledger_v2_diff_snapshot|wallet_ledger_v2_diff_report)'
                  AND jobname IS DISTINCT FROM 'wallet_ledger_v2_diff_hourly'$q$ INTO bad;
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'APPLY REFUSED 0623 — cron job(s) name a P27 table or a dropped function: %', bad;
    END IF;
  END IF;

  SELECT string_agg(v.oid::regclass::text || ' md5=' || md5(pg_get_viewdef(v.oid)), ', ') INTO bad
    FROM pg_class v
   WHERE v.relkind IN ('v', 'm') AND pg_get_viewdef(v.oid) ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)'
     AND NOT (v.oid = 'public.v_judging_drift'::regclass AND md5(pg_get_viewdef(v.oid)) IN ('57268123777d7154f2d33708822114fa'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0623 — unreviewed view(s) read a P27 table: %', bad;
  END IF;

  SELECT string_agg(c.conname || ' on ' || c.conrelid::regclass::text, ', ') INTO bad
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid IN ('public.wallet_ledger_v2_diff_log'::regclass, 'public.v3_mirror_log'::regclass, 'public.wallet_ledger_v2_rows'::regclass)
     AND c.conrelid NOT IN ('public.wallet_ledger_v2_diff_log'::regclass, 'public.v3_mirror_log'::regclass, 'public.wallet_ledger_v2_rows'::regclass);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0623 — foreign keys point into a P27 table: %', bad;
  END IF;

  SELECT string_agg(a.attrelid::regclass::text || '.' || a.attname, ', ') INTO bad
    FROM pg_attribute a
   WHERE a.attrelid IN ('public.wallet_ledger_v2_diff_log'::regclass, 'public.v3_mirror_log'::regclass, 'public.wallet_ledger_v2_rows'::regclass)
     AND a.attnum > 0 AND NOT a.attisdropped AND (a.attgenerated <> '' OR a.attidentity <> '');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0623 — generated / identity columns are not handled by this file: %', bad;
  END IF;

  -- the two functions this file replaces keep their attributes
  IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc
           WHERE oid = 'public.mirror_system_tag_to_decision()'::regprocedure)
     OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc
           WHERE oid = 'public.wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'APPLY REFUSED 0623 — mirror_system_tag_to_decision / wallet_ledger_apply_v2 are not SECURITY DEFINER with search_path=public';
  END IF;
  -- the REVOKE in 3b restates the existing decision (20260910_0032); it must be a no-op
  IF has_function_privilege('anon', 'public.wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'APPLY REFUSED 0623 — anon can execute wallet_ledger_apply_v2 today; the restated REVOKE would change access';
  END IF;
  PERFORM set_config('p27.apply_v2_acl',
    coalesce((SELECT proacl::text FROM pg_proc WHERE oid = 'public.wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)'::regprocedure), 'null'),
    true);
END
$pre$;

-- ── 1 ──────────────────────────────────────────────────────────────────────
CREATE SCHEMA p27_archive;
REVOKE ALL ON SCHEMA p27_archive FROM PUBLIC;
COMMENT ON SCHEMA p27_archive IS
  'S10 P27 (20261031_0623): verified copies of three dropped tables and the statements that rebuild them (rollback). No API role has access.';

CREATE TABLE p27_archive.ddl (
  seq   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phase smallint NOT NULL,   -- 1 before rows are restored, 2 after, 3 functions / view / cron
  obj   text NOT NULL,
  stmt  text NOT NULL
);
CREATE TABLE p27_archive.manifest (
  table_name  text PRIMARY KEY,
  row_count   bigint NOT NULL,
  rows_md5    text NOT NULL,
  verified    boolean NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

DO $capture$
DECLARE
  t text; r record; rel regclass; seqname text; lastv bigint;
  tabs constant text[] := ARRAY['wallet_ledger_v2_diff_log', 'v3_mirror_log', 'wallet_ledger_v2_rows'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    rel := ('public.' || t)::regclass;

    -- column defaults; a nextval() default also needs its sequence back
    FOR r IN SELECT a.attname, pg_get_expr(d.adbin, d.adrelid) AS def
               FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
              WHERE d.adrelid = rel ORDER BY a.attnum LOOP
      seqname := substring(r.def FROM $re$nextval\('([^']+)'::regclass\)$re$);
      IF seqname IS NOT NULL THEN
        EXECUTE format('SELECT last_value FROM %s', seqname) INTO lastv;
        INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES
          (1, t, format('CREATE SEQUENCE IF NOT EXISTS %s', seqname)),
          (2, t, format('ALTER SEQUENCE %s OWNED BY public.%I.%I', seqname, t, r.attname)),
          (2, t, format('SELECT setval(%L, %s, true)', seqname, lastv));
      END IF;
      INSERT INTO p27_archive.ddl (phase, obj, stmt)
        VALUES (1, t, format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %s', t, r.attname, r.def));
    END LOOP;

    -- primary key / unique / exclusion / foreign key (CHECK and NOT NULL travel with LIKE)
    FOR r IN SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
              WHERE c.conrelid = rel AND c.contype IN ('p', 'u', 'x', 'f')
              ORDER BY (c.contype = 'f'), c.conname LOOP
      INSERT INTO p27_archive.ddl (phase, obj, stmt)
        VALUES (2, t, format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', t, r.conname, r.def));
    END LOOP;

    -- indexes that do not back a constraint
    FOR r IN SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
              WHERE i.indrelid = rel
                AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid AND c.conrelid = rel)
              ORDER BY i.indexrelid::regclass::text LOOP
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t, r.def);
    END LOOP;

    -- RLS, policies
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t, format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t));
    END IF;
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = rel) THEN
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t, format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t));
    END IF;
    FOR r IN SELECT p.policyname, p.permissive, p.cmd, p.roles, p.qual, p.with_check FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = t ORDER BY p.policyname LOOP
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t,
        format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s', r.policyname, t, r.permissive, r.cmd,
               (SELECT string_agg(CASE WHEN x = 'public' THEN 'PUBLIC' ELSE quote_ident(x) END, ', ') FROM unnest(r.roles) x),
               CASE WHEN r.qual IS NULL THEN '' ELSE ' USING (' || r.qual || ')' END,
               CASE WHEN r.with_check IS NULL THEN '' ELSE ' WITH CHECK (' || r.with_check || ')' END));
    END LOOP;

    -- grants: start from nothing, then exactly what the table had
    INSERT INTO p27_archive.ddl (phase, obj, stmt)
      VALUES (2, t, format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t));
    FOR r IN SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(a.grantee::regrole::text) END AS who,
                    a.privilege_type, a.is_grantable
               FROM pg_class c, aclexplode(c.relacl) a
              WHERE c.oid = rel AND a.grantee <> c.relowner ORDER BY 1, 2 LOOP
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t,
        format('GRANT %s ON public.%I TO %s%s', r.privilege_type, t, r.who, CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END));
    END LOOP;

    -- triggers on the table, comments, publications
    FOR r IN SELECT pg_get_triggerdef(tg.oid) AS def FROM pg_trigger tg WHERE tg.tgrelid = rel AND NOT tg.tgisinternal ORDER BY tg.tgname LOOP
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t, r.def);
    END LOOP;
    FOR r IN SELECT d.objsubid, a.attname, d.description FROM pg_description d
               LEFT JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
              WHERE d.classoid = 'pg_class'::regclass AND d.objoid = rel ORDER BY d.objsubid LOOP
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t,
        CASE WHEN r.objsubid = 0 THEN format('COMMENT ON TABLE public.%I IS %L', t, r.description)
             ELSE format('COMMENT ON COLUMN public.%I.%I IS %L', t, r.attname, r.description) END);
    END LOOP;
    FOR r IN SELECT pb.pubname FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid = pr.prpubid WHERE pr.prrelid = rel LOOP
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (2, t, format('ALTER PUBLICATION %I ADD TABLE public.%I', r.pubname, t));
    END LOOP;
  END LOOP;

  -- every function this file replaces or drops, exactly as it is now, + its grants and comment
  FOR r IN SELECT p.oid, p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def, p.proacl, p.proowner,
                  obj_description(p.oid, 'pg_proc') AS cmt
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND p.prosrc ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)'
            ORDER BY 2 LOOP
    INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (3, r.sig, r.def);
    INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (3, r.sig, format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sig));
    INSERT INTO p27_archive.ddl (phase, obj, stmt)
      SELECT 3, r.sig, format('GRANT EXECUTE ON FUNCTION %s TO %s', r.sig,
                              CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(a.grantee::regrole::text) END)
        FROM aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) a
       WHERE a.grantee <> r.proowner AND a.privilege_type = 'EXECUTE';
    IF r.cmt IS NOT NULL THEN
      INSERT INTO p27_archive.ddl (phase, obj, stmt) VALUES (3, r.sig, format('COMMENT ON FUNCTION %s IS %L', r.sig, r.cmt));
    END IF;
  END LOOP;

  -- the view, with its options
  INSERT INTO p27_archive.ddl (phase, obj, stmt)
    SELECT 3, 'public.v_judging_drift',
           format('CREATE OR REPLACE VIEW public.v_judging_drift%s AS %s',
                  CASE WHEN c.reloptions IS NULL THEN '' ELSE ' WITH (' || array_to_string(c.reloptions, ', ') || ')' END,
                  pg_get_viewdef(c.oid))
      FROM pg_class c WHERE c.oid = 'public.v_judging_drift'::regclass;

  -- the cron job
  IF to_regclass('cron.job') IS NOT NULL THEN
    INSERT INTO p27_archive.ddl (phase, obj, stmt)
      SELECT 3, 'cron:' || j.jobname, format('SELECT cron.schedule(%L, %L, %L)', j.jobname, j.schedule, j.command)
        FROM cron.job j WHERE j.jobname = 'wallet_ledger_v2_diff_hourly';
  END IF;
END
$capture$;

-- ── 2 ──────────────────────────────────────────────────────────────────────
DO $archive$
DECLARE
  t text; n_src bigint; n_dst bigint; m_src text; m_dst text;
  tabs constant text[] := ARRAY['wallet_ledger_v2_diff_log', 'v3_mirror_log', 'wallet_ledger_v2_rows'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE MODE', t);   -- no writes between copy and check
    EXECUTE format('CREATE TABLE p27_archive.%I (LIKE public.%I INCLUDING CONSTRAINTS INCLUDING COMMENTS INCLUDING STORAGE)', t, t);
    EXECUTE format('INSERT INTO p27_archive.%I SELECT * FROM public.%I', t, t);
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(x::text, E''\n'' ORDER BY x::text), '''')) FROM public.%I x', t) INTO n_src, m_src;
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(x::text, E''\n'' ORDER BY x::text), '''')) FROM p27_archive.%I x', t) INTO n_dst, m_dst;
    IF n_src <> n_dst OR m_src <> m_dst THEN
      RAISE EXCEPTION 'APPLY FAILED 0623 — archive copy of % does not match (rows % vs %, md5 % vs %)', t, n_src, n_dst, m_src, m_dst;
    END IF;
    INSERT INTO p27_archive.manifest (table_name, row_count, rows_md5, verified) VALUES (t, n_src, m_src, true);
    RAISE NOTICE '0623 archive|%|rows=%|md5=%|verified', t, n_src, m_src;
  END LOOP;
END
$archive$;

REVOKE ALL ON ALL TABLES IN SCHEMA p27_archive FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA p27_archive FROM PUBLIC, anon, authenticated, service_role;

-- ── 3 ──────────────────────────────────────────────────────────────────────
-- 3a  the judging mirror trigger, rebuilt from its LIVE definition (identical on
--     both lanes, md5 7538b274…; it matches no file in git — printed by PROBE 0624,
--     staging run 41187751185) with exactly its 9 INSERTs into v3_mirror_log
--     removed. Everything else is byte-for-byte the live text, including the
--     BUG-052 handler that re-raises (a tag write cannot commit without its
--     mirrored decision).
CREATE OR REPLACE FUNCTION public.mirror_system_tag_to_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass        text;
  v_tag_id        uuid;
  v_tag_label     text;
  v_stage         public.v3_stage_catalog%ROWTYPE;
  v_alias_key     text;
  v_resolved_via  text := 'direct';
  v_entry_id      uuid;
  v_judge_id      uuid;
  v_round         integer;
  v_photo_idx     integer;
  v_op            text := TG_OP;
BEGIN
  BEGIN
    v_bypass := current_setting('app.bypass_mirror_trigger', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_op = 'DELETE' THEN
    v_tag_id    := OLD.tag_id;
    v_entry_id  := OLD.entry_id;
    v_judge_id  := OLD.judge_id;
    v_round     := OLD.round_number;
    v_photo_idx := COALESCE(OLD.photo_index, 0);
  ELSE
    v_tag_id    := NEW.tag_id;
    v_entry_id  := NEW.entry_id;
    v_judge_id  := NEW.judge_id;
    v_round     := NEW.round_number;
    v_photo_idx := COALESCE(NEW.photo_index, 0);
  END IF;

  SELECT label INTO v_tag_label FROM public.judging_tags WHERE id = v_tag_id;

  IF v_tag_label IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO v_stage
  FROM public.v3_stage_catalog
  WHERE is_active = true
    AND round_number = v_round
    AND lower(trim(tag_label_canonical)) = lower(trim(v_tag_label))
  LIMIT 1;

  IF v_stage.stage_key IS NULL THEN
    SELECT canonical_stage_key INTO v_alias_key
    FROM public.v3_tag_label_alias
    WHERE round_number = v_round
      AND lower(trim(alias_label)) = lower(trim(v_tag_label))
    LIMIT 1;

    IF v_alias_key IS NOT NULL THEN
      SELECT * INTO v_stage
      FROM public.v3_stage_catalog
      WHERE stage_key = v_alias_key
        AND is_active = true
      LIMIT 1;
      IF v_stage.stage_key IS NOT NULL THEN
        v_resolved_via := 'alias';
      END IF;
    END IF;
  END IF;

  IF v_stage.stage_key IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_op = 'DELETE' THEN
    IF v_round = 4 THEN
      DELETE FROM public.judge_award_tags
       WHERE entry_id     = v_entry_id
         AND judge_id     = v_judge_id
         AND round_number = v_round
         AND photo_index  = v_photo_idx
         AND stage_key    = v_stage.stage_key;

    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.judge_tag_assignments other_jta
      JOIN public.judging_tags other_t ON other_t.id = other_jta.tag_id
      LEFT JOIN public.v3_stage_catalog other_s
        ON other_s.is_active = true
       AND other_s.round_number = other_jta.round_number
       AND lower(trim(other_s.tag_label_canonical)) = lower(trim(other_t.label))
      LEFT JOIN public.v3_tag_label_alias other_a
        ON other_a.round_number = other_jta.round_number
       AND lower(trim(other_a.alias_label)) = lower(trim(other_t.label))
      WHERE other_jta.entry_id = v_entry_id
        AND other_jta.judge_id = v_judge_id
        AND other_jta.round_number = v_round
        AND COALESCE(other_jta.photo_index, 0) = v_photo_idx
        AND other_jta.id <> OLD.id
        AND (other_s.stage_key IS NOT NULL OR other_a.canonical_stage_key IS NOT NULL)
    ) THEN
      DELETE FROM public.judge_decisions
       WHERE entry_id = v_entry_id
         AND judge_id = v_judge_id
         AND round_number = v_round
         AND COALESCE(photo_index, 0) = v_photo_idx;

    ELSE
      NULL;  -- sibling system tag still present; decision preserved
    END IF;

    RETURN OLD;
  END IF;

  IF v_round = 4 THEN
    INSERT INTO public.judge_award_tags
      (entry_id, judge_id, round_number, photo_index,
       stage_key, decision_token, tag_label, tag_id, source_assignment_id)
    VALUES
      (v_entry_id, v_judge_id, v_round, v_photo_idx,
       v_stage.stage_key, v_stage.decision_token, v_tag_label, v_tag_id, NEW.id)
    ON CONFLICT (entry_id, judge_id, round_number, photo_index, stage_key)
    DO UPDATE
      SET decision_token       = EXCLUDED.decision_token,
          tag_label            = EXCLUDED.tag_label,
          tag_id               = EXCLUDED.tag_id,
          source_assignment_id = EXCLUDED.source_assignment_id,
          updated_at           = now();

  END IF;

  INSERT INTO public.judge_decisions
    (entry_id, judge_id, round_number, photo_index, decision, stage_key)
  VALUES
    (v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token, v_stage.stage_key)
  ON CONFLICT (entry_id, judge_id, round_number, photo_index)
  DO UPDATE
    SET decision   = EXCLUDED.decision,
        stage_key  = EXCLUDED.stage_key,
        updated_at = now();


  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- BUG-052: do NOT swallow. Surface a server-log warning and re-raise so the
  -- judge-tag write cannot commit without its mirrored decision.
  RAISE WARNING '[mirror_system_tag_to_decision] entry=% judge=% round=% photo=%: %',
    v_entry_id, v_judge_id, v_round, v_photo_idx, SQLERRM;
  RAISE;
END;
$function$;

-- 3b  wallet_ledger_apply_v2: live branch F retired (dry run unchanged)
CREATE OR REPLACE FUNCTION public.wallet_ledger_apply_v2(
  p_op text,
  p_user_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_description text DEFAULT NULL::text,
  p_reference_id text DEFAULT NULL::text,
  p_source_path text DEFAULT NULL::text,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_balance_before numeric;
  v_balance_after  numeric;
  v_existing       public.wallet_ledger_idempotency%ROWTYPE;
  v_actor          uuid := auth.uid();
  v_role           text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- A. Input validation
  IF p_op IS NULL OR length(trim(p_op)) = 0
     OR p_user_id IS NULL
     OR p_amount IS NULL
     OR p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, error_code, error_message, dry_run, source_path
    ) VALUES (
      COALESCE(p_op,'<null>'), v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'error', 'INVALID_INPUT',
      'op/user_id/amount/idempotency_key required and non-empty',
      p_dry_run, p_source_path
    );
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_INPUT');
  END IF;

  -- B. Idempotency replay
  SELECT * INTO v_existing
    FROM public.wallet_ledger_idempotency
   WHERE op = p_op AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, balance_after, dry_run, source_path
    ) VALUES (
      p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'replay', v_existing.result_balance_after, p_dry_run, p_source_path
    );
    RETURN jsonb_build_object(
      'ok', true, 'replay', true,
      'balance_after', v_existing.result_balance_after,
      'txn_id', v_existing.result_txn_id
    );
  END IF;

  -- C. Read current balance (no mutation)
  SELECT COALESCE(balance, 0) INTO v_balance_before
    FROM public.wallets WHERE user_id = p_user_id;
  IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;
  -- MIRROR MODE (Phase 1A · C.fix-3 · Option A):
  -- Legacy wallet_transaction() is the authoritative balance writer. It
  -- commits at T+0; this function runs at T+~234 ms (ordering proven in
  -- docs/fix-sprints/phase-1a-step-c-branch-f-balance-after-audit.md §1.4).
  -- Therefore v_balance_before already reflects the post-legacy authoritative
  -- balance. Do NOT re-apply p_amount here; p_amount is preserved as a
  -- column in the (retired) v2 rows table for downstream reconciliation.
  v_balance_after := v_balance_before;

  -- D. Overdraft guard
  IF v_balance_after < 0 THEN
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, error_code, error_message,
      balance_before, dry_run, source_path
    ) VALUES (
      p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'error', 'OVERDRAFT',
      'insufficient balance: would result in negative wallet',
      v_balance_before, p_dry_run, p_source_path
    );
    RETURN jsonb_build_object(
      'ok', false, 'error_code', 'OVERDRAFT',
      'balance_before', v_balance_before, 'amount', p_amount
    );
  END IF;

  -- E. DRY RUN PATH — log only
  IF p_dry_run THEN
    INSERT INTO public.wallet_ledger_shadow_log(
      source_path, op, idempotency_key, intended_user_id, intended_amount,
      computed_balance_before, computed_balance_after, validation_ok
    ) VALUES (
      p_source_path, p_op, p_idempotency_key, p_user_id, p_amount,
      v_balance_before, v_balance_after, true
    );
    INSERT INTO public.wallet_ledger_audit_log(
      op, actor_user_id, target_user_id, amount, idempotency_key,
      request_jwt_role, result, balance_before, balance_after, dry_run, source_path
    ) VALUES (
      p_op, v_actor, p_user_id, p_amount, p_idempotency_key,
      v_role, 'dry_run_ok', v_balance_before, v_balance_after, true, p_source_path
    );
    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true,
      'balance_before', v_balance_before,
      'balance_after',  v_balance_after
    );
  END IF;

  -- F. LIVE PATH — RETIRED by P27 (20261031_0623). It wrote only to
  --    the v2 rows table, which is dropped (Owner decision 16, 2026-10-31).
  --    No caller passes p_dry_run = false (the four edge callers are dry-run
  --    shadows); a live call now refuses without writing anything.
  RETURN jsonb_build_object('ok', false, 'error_code', 'V2_LIVE_PATH_RETIRED');
END;
$function$;

-- Who may execute it is unchanged (20260910_0032): not PUBLIC, not anon. A no-op here (checked in G and P).
REVOKE EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) FROM PUBLIC, anon;

-- 3c  v_judging_drift without the F4 branch; same columns, same options
DO $view$
DECLARE opts text;
BEGIN
  SELECT CASE WHEN c.reloptions IS NULL THEN '' ELSE ' WITH (' || array_to_string(c.reloptions, ', ') || ')' END
    INTO opts FROM pg_class c WHERE c.oid = 'public.v_judging_drift'::regclass;
  EXECUTE format('CREATE OR REPLACE VIEW public.v_judging_drift%s AS %s', opts, $def$
SELECT 'F1_TAG_WITHOUT_DECISION'::text AS finding_code,
       'judge_tag_assignments'::text   AS source_table,
       jta.id                          AS source_row_id,
       jta.entry_id, jta.judge_id, jta.round_number, jta.photo_index,
       jt.label                        AS detail_label,
       NULL::text                      AS expected_value,
       NULL::text                      AS actual_value,
       jta.created_at                  AS occurred_at
  FROM public.judge_tag_assignments jta
  LEFT JOIN public.judging_tags jt ON jt.id = jta.tag_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.judge_decisions jd
    WHERE jd.entry_id = jta.entry_id
      AND jd.judge_id = jta.judge_id
      AND jd.round_number = jta.round_number
      AND NOT jd.photo_index IS DISTINCT FROM jta.photo_index)
UNION ALL
SELECT 'F2_DECISION_WITHOUT_ALIAS'::text, 'judge_decisions'::text,
       jd.id, jd.entry_id, jd.judge_id, jd.round_number, jd.photo_index,
       jd.decision, jd.stage_key, NULL::text, jd.created_at
  FROM public.judge_decisions jd
 WHERE jd.decision IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.v3_tag_label_alias a
      WHERE lower(a.alias_label) = lower(jd.decision)
        AND a.round_number = jd.round_number)
UNION ALL
SELECT DISTINCT 'F3_TAG_LABEL_NO_ALIAS'::text, 'judging_tags'::text,
       jt.id, NULL::uuid, NULL::uuid, jta.round_number, NULL::integer,
       jt.label, NULL::text, NULL::text, min(jta.created_at)
  FROM public.judge_tag_assignments jta
  JOIN public.judging_tags jt ON jt.id = jta.tag_id
 WHERE jt.label IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.v3_tag_label_alias a
      WHERE lower(a.alias_label) = lower(jt.label)
        AND a.round_number = jta.round_number)
 GROUP BY jt.id, jt.label, jta.round_number
UNION ALL
SELECT 'F5_CURRENT_ROUND_INVALID'::text, 'competition_entries'::text,
       ce.id, ce.id, NULL::uuid, NULL::integer, NULL::integer,
       ce.current_round, '1|2|3|4'::text, ce.current_round, ce.updated_at
  FROM public.competition_entries ce
 WHERE ce.current_round IS NOT NULL
   AND COALESCE(NULLIF(regexp_replace(ce.current_round, '[^0-9]', '', 'g'), ''), '0')::int <> ALL (ARRAY[1,2,3,4])
$def$);
END
$view$;

-- 3d  the hourly v2 diff job and the functions that only read the dropped tables
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wallet_ledger_v2_diff_hourly') THEN
    PERFORM cron.unschedule('wallet_ledger_v2_diff_hourly');
  END IF;
END
$cron$;
DROP FUNCTION public.wallet_ledger_v2_diff_snapshot(interval);
DROP FUNCTION public.wallet_ledger_v2_diff_report(interval);

-- ── 4 ──────────────────────────────────────────────────────────────────────
DROP TABLE public.wallet_ledger_v2_diff_log RESTRICT;
DROP TABLE public.v3_mirror_log RESTRICT;
DROP TABLE public.wallet_ledger_v2_rows RESTRICT;

-- ── P ──────────────────────────────────────────────────────────────────────
DO $post$
DECLARE bad text; n int;
BEGIN
  IF to_regclass('public.wallet_ledger_v2_diff_log') IS NOT NULL OR to_regclass('public.v3_mirror_log') IS NOT NULL
     OR to_regclass('public.wallet_ledger_v2_rows') IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY FAILED 0623 — a P27 table is still in public';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'APPLY FAILED 0623 — function bodies still name a dropped table: %', bad; END IF;
  SELECT string_agg(v.oid::regclass::text, ', ') INTO bad FROM pg_class v
   WHERE v.relkind IN ('v', 'm') AND pg_get_viewdef(v.oid) ~ '(wallet_ledger_v2_diff_log|v3_mirror_log|wallet_ledger_v2_rows)';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'APPLY FAILED 0623 — views still name a dropped table: %', bad; END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.judge_tag_assignments'::regclass AND tgfoid = 'public.mirror_system_tag_to_decision()'::regprocedure
     AND NOT tgisinternal AND tgenabled <> 'D';
  IF n < 1 THEN RAISE EXCEPTION 'APPLY FAILED 0623 — the judging mirror trigger is not attached and enabled'; END IF;
  SELECT count(*) INTO n FROM p27_archive.manifest WHERE verified;
  IF n <> 3 THEN RAISE EXCEPTION 'APPLY FAILED 0623 — manifest has % verified tables, want 3', n; END IF;
  IF has_schema_privilege('anon', 'p27_archive', 'USAGE') OR has_schema_privilege('authenticated', 'p27_archive', 'USAGE')
     OR has_schema_privilege('service_role', 'p27_archive', 'USAGE') THEN
    RAISE EXCEPTION 'APPLY FAILED 0623 — an API role can use schema p27_archive';
  END IF;
  IF coalesce((SELECT proacl::text FROM pg_proc WHERE oid = 'public.wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)'::regprocedure), 'null')
     <> current_setting('p27.apply_v2_acl') THEN
    RAISE EXCEPTION 'APPLY FAILED 0623 — wallet_ledger_apply_v2 permissions changed';
  END IF;
  RAISE NOTICE '0623 POST PASS — 3 tables archived (verified) and dropped; no function or view names them; mirror trigger attached';
END
$post$;

COMMIT;
