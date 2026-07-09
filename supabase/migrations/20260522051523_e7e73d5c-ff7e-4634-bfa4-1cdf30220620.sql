REVOKE EXECUTE ON FUNCTION public.send_notification_email() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_notification_email() FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_notification_email() FROM authenticated;