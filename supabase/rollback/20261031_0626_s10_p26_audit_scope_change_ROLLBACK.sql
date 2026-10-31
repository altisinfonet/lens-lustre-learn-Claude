-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0626 — S10 P26. Puts back exactly what 0626 replaced:
-- the two audit trigger function bodies as measured by PROBE 0624 (md5
-- b5cf7059… / 82b93c33…, checked after the replace), INSERT OR DELETE OR
-- UPDATE audit triggers on the seven tables 0626 made delete-only, and drops
-- p26_jsonb_change. Rows written while 0626 was live stay as they are (they
-- hold the change, marked "_p26":"change"). ONE TRANSACTION.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted as staging or production';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.audit_sensitive_table()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, changed_by)
    VALUES (TG_TABLE_NAME, 'DELETE', OLD.id::text, to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, 'UPDATE', NEW.id::text, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
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
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, changed_by)
    VALUES (TG_TABLE_NAME, 'DELETE', OLD.key, to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, 'UPDATE', NEW.key, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
    VALUES (TG_TABLE_NAME, 'INSERT', NEW.key, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

DO $scope$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['certificates', 'competition_entries', 'competition_votes', 'judge_comments',
                           'judge_decisions', 'judge_scores', 'judge_tag_assignments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'audit_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR DELETE OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table()', 'audit_' || t, t);
  END LOOP;
END
$scope$;

DROP FUNCTION IF EXISTS public.p26_jsonb_change(jsonb, jsonb);

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.audit_sensitive_table()'::regprocedure) <> 'b5cf70597a0bf228d015115cd7e5e899'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.audit_site_settings_table()'::regprocedure) <> '82b93c33c392e29d33a0d4beab4f68c6' THEN
    RAISE EXCEPTION 'ROLLBACK FAILED 0626 — restored bodies do not match the measured md5';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = 'audit_' || c.relname AND NOT t.tgisinternal AND (t.tgtype & 28) = 28) <> 12 THEN
    RAISE EXCEPTION 'ROLLBACK FAILED 0626 — not all 12 audit triggers are INSERT OR DELETE OR UPDATE';
  END IF;
  RAISE NOTICE 'ROLLBACK 0626 POST PASS — original bodies (md5 match) and 12 full audit triggers';
END
$post$;

COMMIT;
