INSERT INTO public.site_settings (key, value)
VALUES ('judging_realtime_distributed_mode', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;