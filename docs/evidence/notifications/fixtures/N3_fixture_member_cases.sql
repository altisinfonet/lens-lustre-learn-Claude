\pset tuples_only on
\pset format unaligned
INSERT INTO auth.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001'),('bbbbbbbb-0000-0000-0000-000000000002'),('cccccccc-0000-0000-0000-000000000003');
DELETE FROM public.user_notifications;
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','post_reaction','t','m');
SELECT 'off_self_written(1)', count(*) FROM public.user_notifications;
INSERT INTO public.site_settings VALUES ('notif_centre_likes_comments', '{"users":["aaaaaaaa-0000-0000-0000-000000000001"]}');
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','post_reaction','t','m');
SELECT 'on_self_skipped(1)', count(*) FROM public.user_notifications;
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message, reference_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','post_reaction','t','m','dddddddd-0000-0000-0000-000000000004');
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message, reference_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','post_reaction','t','m','dddddddd-0000-0000-0000-000000000004');
SELECT 'on_dup_skipped(2)', count(*) FROM public.user_notifications;
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message) VALUES ('cccccccc-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000003','post_reaction','t','m');
SELECT 'unlisted_unchanged(3)', count(*) FROM public.user_notifications;
INSERT INTO public.notification_preferences(user_id, email_reactions) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', false);
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message, reference_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003','post_reaction','t','m','eeeeeeee-0000-0000-0000-000000000005') RETURNING 'email_off_sets_email_sent(t)', email_sent;
UPDATE public.notification_preferences SET inapp_reactions=false WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message, reference_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003','post_reaction','t','m','ffffffff-0000-0000-0000-000000000006');
SELECT 'inapp_off_skipped(4)', count(*) FROM public.user_notifications;
INSERT INTO public.user_notifications(user_id, type, title, message) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','mystery','t','m');
SELECT 'unregistered_passes(5)', count(*) FROM public.user_notifications;
ALTER TABLE public.notification_types RENAME COLUMN group_key TO group_key_x;
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','post_reaction','t','m');
SELECT 'fault_passes(6)', count(*) FROM public.user_notifications;
ALTER TABLE public.notification_types RENAME COLUMN group_key_x TO group_key;
