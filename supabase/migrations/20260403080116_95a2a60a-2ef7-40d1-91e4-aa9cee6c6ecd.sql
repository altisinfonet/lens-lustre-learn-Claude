
-- PHASE 1: DB Audit Logs table for tracking sensitive table changes
CREATE TABLE public.db_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  operation text NOT NULL,
  row_id text,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_db_audit_logs_table_created ON public.db_audit_logs (table_name, created_at DESC);
CREATE INDEX idx_db_audit_logs_changed_by ON public.db_audit_logs (changed_by, created_at DESC);

-- RLS: only admins can read audit logs
ALTER TABLE public.db_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit logs"
  ON public.db_audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No insert/update/delete from client — only triggers write here

-- PHASE 2: Audit trigger function
CREATE OR REPLACE FUNCTION public.audit_sensitive_table()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
$$;

-- Attach to sensitive tables
CREATE TRIGGER audit_wallet_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();

CREATE TRIGGER audit_withdrawal_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();

CREATE TRIGGER audit_certificates
  AFTER INSERT OR UPDATE OR DELETE ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();

CREATE TRIGGER audit_competition_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.competition_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();

CREATE TRIGGER audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();

CREATE TRIGGER audit_site_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();
