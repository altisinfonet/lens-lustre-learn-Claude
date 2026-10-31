\pset format unaligned
\pset tuples_only on
INSERT INTO public.notification_types(type,audience,group_key,wording_key,channels,pref_in_app,pref_push,pref_email,rate_per_hour) VALUES
 ('post_reaction','member','likes_comments','post_reaction','{in_app,push,email}','inapp_reactions','push_reactions','email_reactions',3),
 ('new_ticket','admin','admin_alerts','new_ticket','{in_app}',NULL,NULL,NULL,NULL),
 ('off_type','member','account','x','{in_app}',NULL,NULL,NULL,NULL);
UPDATE public.notification_types SET enabled=false WHERE type='off_type';
-- people
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''
\set R '''dddddddd-0000-0000-0000-000000000004'''
INSERT INTO auth.users VALUES (:A),(:B),(:C);
SELECT 'clean', public.notification_centre_decide('post_reaction', :A, :B, :R);
SELECT 'self', public.notification_centre_decide('post_reaction', :A, :A, :R);
SELECT 'unregistered', public.notification_centre_decide('nope', :A, :B, :R);
SELECT 'type_off', public.notification_centre_decide('off_type', :A, :B, :R);
INSERT INTO public.user_blocks VALUES (:A, :C);
SELECT 'blocked_by_recipient', public.notification_centre_decide('post_reaction', :A, :C, :R);
SELECT 'blocked_actor_side', public.notification_centre_decide('post_reaction', :C, :A, :R);
INSERT INTO public.user_notifications(user_id,actor_id,type,title,message,reference_id,created_at) VALUES (:A,:B,'post_reaction','t','m',:R, now()-interval '20 seconds');
SELECT 'duplicate', public.notification_centre_decide('post_reaction', :A, :B, :R);
SELECT 'not_dup_after_window', public.notification_centre_decide('post_reaction', :A, :B, :R, now()+interval '2 minutes');
INSERT INTO public.user_notifications(user_id,actor_id,type,title,message,reference_id,created_at) SELECT :A,gen_random_uuid(),'post_reaction','t','m',gen_random_uuid(), now()-interval '10 minutes' FROM generate_series(1,2);
SELECT 'rate_limited(3 in last hour)', public.notification_centre_decide('post_reaction', :A, gen_random_uuid(), gen_random_uuid());
INSERT INTO public.notification_preferences(user_id, push_enabled) VALUES (:B, false);
SELECT 'push_master_off', public.notification_centre_decide('post_reaction', :B, :A, :R);
UPDATE public.notification_preferences SET push_enabled=true, inapp_reactions=false WHERE user_id=:B;
SELECT 'inapp_off', public.notification_centre_decide('post_reaction', :B, :A, :R);
UPDATE public.notification_preferences SET inapp_reactions=true, email_reactions=false WHERE user_id=:B;
SELECT 'email_off_only', public.notification_centre_decide('post_reaction', :B, :A, :R);
INSERT INTO public.notification_quiet_hours VALUES (:B, '22:00','07:00','UTC');
SELECT 'quiet_hours_03utc', public.notification_centre_decide('post_reaction', :B, :A, :R, date_trunc('day', now()) + interval '3 hours');
SELECT 'quiet_hours_12utc', public.notification_centre_decide('post_reaction', :B, :A, :R, date_trunc('day', now()) + interval '12 hours');
-- replay semantics: the row itself must not count as its own duplicate
SELECT 'replay_self_excluded', public.notification_centre_decide(un.type, un.user_id, un.actor_id, un.reference_id, un.created_at, un.id)
  FROM public.user_notifications un WHERE un.actor_id = :B LIMIT 1;
INSERT INTO public.admin_notifications(type, reference_id) VALUES ('new_ticket', :R);
SELECT 'admin_dup', public.notification_centre_decide('new_ticket', NULL, NULL, :R);
SELECT 'admin_other_ref', public.notification_centre_decide('new_ticket', NULL, NULL, gen_random_uuid());
SELECT 'switch_default', public.notification_centre_live('likes_comments');
INSERT INTO public.site_settings VALUES ('notif_centre_likes_comments', to_jsonb('live'::text));
SELECT 'switch_live', public.notification_centre_live('likes_comments');
-- emit: likes_comments is live (set above) → writes; another group off → NULL, nothing written
SELECT 'emit_live_writes', public.notification_centre_emit('post_reaction', :C, :B, gen_random_uuid(), 't', 'm') IS NOT NULL;
SELECT 'emit_live_suppressed_self_null', public.notification_centre_emit('post_reaction', :C, :C, gen_random_uuid(), 't', 'm') IS NULL;
SELECT 'emit_off_group_null', public.notification_centre_emit('new_ticket', NULL, NULL, gen_random_uuid(), 't', 'm') IS NULL;
SELECT 'log_rows(2: one sent, one self)', count(*), count(*) FILTER (WHERE sent) FROM public.notification_centre_log;
SELECT 'replay', r.* FROM public.notification_centre_replay(now() - interval '1 day', now() + interval '1 day') r;
