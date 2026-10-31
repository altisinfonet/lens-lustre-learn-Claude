-- ═══════════════════════════════════════════════════════════════════════════
-- S10 P26 · 20261031_0626 — audit triggers: money, permissions and deletions
-- only; an UPDATE stores the change, not two full row copies.
-- Owner decision 15 (2026-10-31 08:13 UTC, #553): "P26: as proposed".
--
-- GATE (GATE_REGISTER P26): audit triggers limited to money, permissions and
-- deletions; the change stored rather than two full row copies; rows older
-- than a stated window moved out of the live database. This file is the first
-- two clauses. The retention clause is a separate unit.
--
-- MEASURED (PROBE 0622 staging 41186134121 / production 41187337459; PROBE
-- 0624 staging 41187751185 printed the live bodies; PROBE 0625 staging
-- 41201522353 / production 41206819857):
--   production db_audit_logs 1,751 rows / 13 MB. site_settings
--   'managed_pages' was saved 382 times, each UPDATE row holding the whole
--   page list twice (~60 kB of text per copy, 23 MB of text in all). Its
--   value is a JSON array of pages that each carry an "id", so neither a
--   column diff nor a one-level object diff saves anything; a diff of that
--   array by id does. 96 of 108 judge_decisions UPDATE rows and 17 of 30
--   ad_zones_v2 rows changed nothing at all.
--
-- WHAT CHANGES
--   1. public.p26_jsonb_change(old jsonb, new jsonb) → (old_part, new_part):
--      only the top-level keys whose value changed. For a changed key whose
--      two values are JSON objects: only their changed keys. For a changed key
--      whose two values are arrays of objects that all carry a distinct "id":
--      {"_by_id": {id: element}} holding only the elements that changed,
--      were added (new side) or were removed (old side), plus "_order" (new
--      side) when only the order of ids changed. Both parts carry
--      "_p26": "change" so a reader knows they are partial. NULL, NULL when
--      nothing changed. IMMUTABLE; not executable by PUBLIC / anon /
--      authenticated (trigger functions are SECURITY DEFINER and own it).
--   2. audit_sensitive_table() and audit_site_settings_table(): INSERT and
--      DELETE rows unchanged (one full copy, as before). UPDATE stores
--      p26_jsonb_change(OLD, NEW) and writes NO row when nothing changed.
--      Same row_id, changed_by, table_name, operation.
--   3. Scope. Money: wallet_transactions, withdrawal_requests,
--      admin_vote_adjustments (adjusted votes pay vote rewards). Permissions:
--      user_roles, site_settings (admin configuration and feature switches).
--      These keep INSERT, UPDATE and DELETE. Everything else audited today —
--      certificates, competition_entries, competition_votes, judge_comments,
--      judge_decisions, judge_scores, judge_tag_assignments — keeps DELETE
--      only. The judging edge functions keep writing their own explicit audit
--      rows (complete-round, submit-judge-decision, nightly invariants), and
--      trg_audit_nr_drift_at_r2_plus is not touched.
--   Existing rows are not rewritten.
--
-- READERS CHECKED: src/lib/admin/videoConversion.ts reads value from
-- old_data / new_data of site_settings rows (a string; present whenever it
-- changed). JudgingInvariantsAudit reads rows written by the nightly function,
-- not by these triggers. hard-delete-competition deletes by row_id. No reader
-- needs an unchanged column.
--
-- GUARDS: refuses unless both trigger function bodies have the md5 they were
-- written against and all 12 audit triggers have exactly the measured
-- definitions. Rollback: supabase/rollback/20261031_0626_…_ROLLBACK.sql.
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
SET LOCAL statement_timeout = '60s';

-- ── G ──────────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  r record; bad text;
  want_trg constant text[][] := ARRAY[
    ['admin_vote_adjustments', 'CREATE TRIGGER audit_admin_vote_adjustments AFTER INSERT OR DELETE OR UPDATE ON public.admin_vote_adjustments FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['certificates',           'CREATE TRIGGER audit_certificates AFTER INSERT OR DELETE OR UPDATE ON public.certificates FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['competition_entries',    'CREATE TRIGGER audit_competition_entries AFTER INSERT OR DELETE OR UPDATE ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['competition_votes',      'CREATE TRIGGER audit_competition_votes AFTER INSERT OR DELETE OR UPDATE ON public.competition_votes FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['judge_comments',         'CREATE TRIGGER audit_judge_comments AFTER INSERT OR DELETE OR UPDATE ON public.judge_comments FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['judge_decisions',        'CREATE TRIGGER audit_judge_decisions AFTER INSERT OR DELETE OR UPDATE ON public.judge_decisions FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['judge_scores',           'CREATE TRIGGER audit_judge_scores AFTER INSERT OR DELETE OR UPDATE ON public.judge_scores FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['judge_tag_assignments',  'CREATE TRIGGER audit_judge_tag_assignments AFTER INSERT OR DELETE OR UPDATE ON public.judge_tag_assignments FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['site_settings',          'CREATE TRIGGER audit_site_settings AFTER INSERT OR DELETE OR UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION audit_site_settings_table()'],
    ['user_roles',             'CREATE TRIGGER audit_user_roles AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['wallet_transactions',    'CREATE TRIGGER audit_wallet_transactions AFTER INSERT OR DELETE OR UPDATE ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()'],
    ['withdrawal_requests',    'CREATE TRIGGER audit_withdrawal_requests AFTER INSERT OR DELETE OR UPDATE ON public.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()']
  ];
  n int := 0;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.audit_sensitive_table()')) IS DISTINCT FROM 'b5cf70597a0bf228d015115cd7e5e899'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.audit_site_settings_table()')) IS DISTINCT FROM '82b93c33c392e29d33a0d4beab4f68c6' THEN
    RAISE EXCEPTION 'APPLY REFUSED 0626 — an audit trigger function body is not the one this file was written against (PROBE 0624)';
  END IF;
  IF to_regprocedure('public.p26_jsonb_change(jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0626 — p26_jsonb_change already exists; run the PROBE, do not re-apply';
  END IF;
  FOR i IN 1 .. array_length(want_trg, 1) LOOP
    SELECT pg_get_triggerdef(t.oid) INTO bad FROM pg_trigger t
     WHERE t.tgrelid = to_regclass('public.' || want_trg[i][1]) AND t.tgname = 'audit_' || want_trg[i][1] AND NOT t.tgisinternal;
    IF bad IS DISTINCT FROM want_trg[i][2] THEN
      RAISE EXCEPTION 'APPLY REFUSED 0626 — trigger audit_% is not as measured: %', want_trg[i][1], coalesce(bad, '(missing)');
    END IF;
  END LOOP;
  -- no other trigger runs these two functions
  SELECT string_agg(c.relname || '.' || t.tgname, ', ') INTO bad
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgfoid IN (to_regprocedure('public.audit_sensitive_table()'), to_regprocedure('public.audit_site_settings_table()'))
     AND NOT t.tgisinternal
     AND (t.tgname <> 'audit_' || c.relname
          OR c.relname <> ALL (ARRAY['admin_vote_adjustments', 'certificates', 'competition_entries', 'competition_votes', 'judge_comments',
                                     'judge_decisions', 'judge_scores', 'judge_tag_assignments', 'site_settings', 'user_roles',
                                     'wallet_transactions', 'withdrawal_requests']));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0626 — unmeasured trigger(s) use the audit functions: %', bad;
  END IF;
END
$pre$;

-- ── 1  the change, not two copies ─────────────────────────────────────────
CREATE FUNCTION public.p26_jsonb_change(p_old jsonb, p_new jsonb, OUT old_part jsonb, OUT new_part jsonb)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE
  k text; ov jsonb; nv jsonb; j text; oo jsonb; nn jsonb;
  o_ids jsonb; n_ids jsonb;
BEGIN
  old_part := NULL; new_part := NULL;
  IF p_old IS NOT DISTINCT FROM p_new THEN RETURN; END IF;
  IF jsonb_typeof(p_old) IS DISTINCT FROM 'object' OR jsonb_typeof(p_new) IS DISTINCT FROM 'object' THEN
    old_part := p_old; new_part := p_new; RETURN;
  END IF;
  old_part := '{}'::jsonb; new_part := '{}'::jsonb;
  FOR k IN SELECT x FROM (SELECT jsonb_object_keys(p_old) x UNION SELECT jsonb_object_keys(p_new)) s ORDER BY 1 LOOP
    ov := p_old -> k; nv := p_new -> k;
    CONTINUE WHEN ov IS NOT DISTINCT FROM nv;
    IF jsonb_typeof(ov) = 'object' AND jsonb_typeof(nv) = 'object' THEN
      oo := '{}'::jsonb; nn := '{}'::jsonb;
      FOR j IN SELECT x FROM (SELECT jsonb_object_keys(ov) x UNION SELECT jsonb_object_keys(nv)) s ORDER BY 1 LOOP
        CONTINUE WHEN (ov -> j) IS NOT DISTINCT FROM (nv -> j);
        IF ov ? j THEN oo := oo || jsonb_build_object(j, ov -> j); END IF;
        IF nv ? j THEN nn := nn || jsonb_build_object(j, nv -> j); END IF;
      END LOOP;
      old_part := old_part || jsonb_build_object(k, oo);
      new_part := new_part || jsonb_build_object(k, nn);
    ELSIF jsonb_typeof(ov) = 'array' AND jsonb_typeof(nv) = 'array'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ov || nv) e
                           WHERE jsonb_typeof(e) <> 'object' OR NOT (e ? 'id') OR jsonb_typeof(e -> 'id') NOT IN ('string', 'number'))
          AND (SELECT count(*) = count(DISTINCT e ->> 'id') FROM jsonb_array_elements(ov) e)
          AND (SELECT count(*) = count(DISTINCT e ->> 'id') FROM jsonb_array_elements(nv) e) THEN
      SELECT coalesce(jsonb_object_agg(e ->> 'id', e), '{}'::jsonb) INTO o_ids FROM jsonb_array_elements(ov) e;
      SELECT coalesce(jsonb_object_agg(e ->> 'id', e), '{}'::jsonb) INTO n_ids FROM jsonb_array_elements(nv) e;
      SELECT coalesce(jsonb_object_agg(x.key, x.value), '{}'::jsonb) INTO oo
        FROM jsonb_each(o_ids) x WHERE (n_ids -> x.key) IS DISTINCT FROM x.value;
      SELECT coalesce(jsonb_object_agg(x.key, x.value), '{}'::jsonb) INTO nn
        FROM jsonb_each(n_ids) x WHERE (o_ids -> x.key) IS DISTINCT FROM x.value;
      old_part := old_part || jsonb_build_object(k, jsonb_build_object('_by_id', oo));
      IF (SELECT jsonb_agg(e -> 'id') FROM jsonb_array_elements(ov) e) IS DISTINCT FROM (SELECT jsonb_agg(e -> 'id') FROM jsonb_array_elements(nv) e) THEN
        new_part := new_part || jsonb_build_object(k, jsonb_build_object('_by_id', nn, '_order', (SELECT coalesce(jsonb_agg(e -> 'id'), '[]'::jsonb) FROM jsonb_array_elements(nv) e)));
      ELSE
        new_part := new_part || jsonb_build_object(k, jsonb_build_object('_by_id', nn));
      END IF;
    ELSE
      IF p_old ? k THEN old_part := old_part || jsonb_build_object(k, ov); END IF;
      IF p_new ? k THEN new_part := new_part || jsonb_build_object(k, nv); END IF;
    END IF;
  END LOOP;
  old_part := old_part || '{"_p26": "change"}'::jsonb;
  new_part := new_part || '{"_p26": "change"}'::jsonb;
END;
$function$;
REVOKE ALL ON FUNCTION public.p26_jsonb_change(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.p26_jsonb_change(jsonb, jsonb) IS
  'S10 P26 (0626): the change between two row images for db_audit_logs. Changed keys only; objects one level down; arrays of id-carrying objects by id ({"_by_id":…, "_order":…}). Both parts carry "_p26":"change". NULL, NULL when nothing changed. Called only by the audit trigger functions.';

-- ── 2  trigger functions: same INSERT / DELETE rows; UPDATE stores the change ──
CREATE OR REPLACE FUNCTION public.audit_sensitive_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, changed_by)
    VALUES (TG_TABLE_NAME, 'DELETE', OLD.id::text, to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- S10 P26: the change only; a save that changed nothing writes no row
    SELECT * INTO c FROM public.p26_jsonb_change(to_jsonb(OLD), to_jsonb(NEW));
    IF c.old_part IS NOT NULL OR c.new_part IS NOT NULL THEN
      INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
      VALUES (TG_TABLE_NAME, 'UPDATE', NEW.id::text, c.old_part, c.new_part, auth.uid());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
    VALUES (TG_TABLE_NAME, 'INSERT', NEW.id::text, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_site_settings_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, changed_by)
    VALUES (TG_TABLE_NAME, 'DELETE', OLD.key, to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- S10 P26: the change only; a save that changed nothing writes no row
    SELECT * INTO c FROM public.p26_jsonb_change(to_jsonb(OLD), to_jsonb(NEW));
    IF c.old_part IS NOT NULL OR c.new_part IS NOT NULL THEN
      INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
      VALUES (TG_TABLE_NAME, 'UPDATE', NEW.key, c.old_part, c.new_part, auth.uid());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
    VALUES (TG_TABLE_NAME, 'INSERT', NEW.key, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

-- ── 3  scope: outside money and permissions, deletions only ───────────────
DO $scope$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['certificates', 'competition_entries', 'competition_votes', 'judge_comments',
                           'judge_decisions', 'judge_scores', 'judge_tag_assignments'] LOOP
    EXECUTE format('DROP TRIGGER %I ON public.%I', 'audit_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table()', 'audit_' || t, t);
  END LOOP;
END
$scope$;

-- ── P  post-checks ────────────────────────────────────────────────────────
DO $post$
DECLARE r record; n int;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname = 'audit_' || c.relname AND NOT t.tgisinternal AND t.tgenabled = 'O'
     AND c.relname IN ('certificates', 'competition_entries', 'competition_votes', 'judge_comments', 'judge_decisions', 'judge_scores', 'judge_tag_assignments')
     AND (t.tgtype & 28) = 8;                    -- DELETE only (INSERT 4, DELETE 8, UPDATE 16)
  IF n <> 7 THEN RAISE EXCEPTION 'APPLY FAILED 0626 — % of 7 delete-only audit triggers', n; END IF;
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname = 'audit_' || c.relname AND NOT t.tgisinternal AND t.tgenabled = 'O'
     AND c.relname IN ('admin_vote_adjustments', 'site_settings', 'user_roles', 'wallet_transactions', 'withdrawal_requests')
     AND (t.tgtype & 28) = 28;
  IF n <> 5 THEN RAISE EXCEPTION 'APPLY FAILED 0626 — % of 5 full audit triggers', n; END IF;
  IF has_function_privilege('anon', 'public.p26_jsonb_change(jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.p26_jsonb_change(jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'APPLY FAILED 0626 — an API role can execute p26_jsonb_change';
  END IF;
  IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.audit_sensitive_table()'::regprocedure)
     OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.audit_site_settings_table()'::regprocedure) THEN
    RAISE EXCEPTION 'APPLY FAILED 0626 — audit functions lost SECURITY DEFINER / search_path';
  END IF;
  RAISE NOTICE '0626 POST PASS — 7 tables delete-only, 5 money/permission tables full; UPDATE rows store the change';
END
$post$;

COMMIT;
