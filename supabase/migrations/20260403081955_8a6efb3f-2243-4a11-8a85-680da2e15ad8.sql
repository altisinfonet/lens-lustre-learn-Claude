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

DROP TRIGGER IF EXISTS audit_site_settings ON public.site_settings;
CREATE TRIGGER audit_site_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_site_settings_table();