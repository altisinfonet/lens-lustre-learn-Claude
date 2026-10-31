REVOKE EXECUTE ON FUNCTION public.get_derived_status_drift_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_derived_status_drift_admin() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_derived_status_drift_admin() TO authenticated;