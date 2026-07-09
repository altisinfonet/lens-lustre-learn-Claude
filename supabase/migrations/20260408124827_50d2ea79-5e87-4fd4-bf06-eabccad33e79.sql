-- Enable realtime for site_settings and user_roles so live-admin-sync channel works
ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;