-- LOCAL FIXTURE ONLY (scratch Postgres). Deletes rows and renames a column on purpose.
-- NEVER run against staging or production. Not a migration; not dispatchable.
\pset tuples_only on
\pset format unaligned
INSERT INTO public.site_settings VALUES ('notif_centre_admin_alerts', to_jsonb('live'::text));
INSERT INTO public.admin_notifications(type, reference_id) VALUES ('new_ticket', 'dddddddd-0000-0000-0000-000000000009');
INSERT INTO public.admin_notifications(type, reference_id) VALUES ('new_ticket', 'dddddddd-0000-0000-0000-000000000009');
SELECT 'admin_rows(expect 1: duplicate skipped)', count(*) FROM public.admin_notifications;
SELECT 'admin_log_rows(expect 2)', count(*) FROM public.notification_centre_log WHERE type = 'new_ticket';
