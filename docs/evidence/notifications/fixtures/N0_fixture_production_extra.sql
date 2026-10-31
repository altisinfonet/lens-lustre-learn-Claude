CREATE SCHEMA cron; CREATE TABLE cron.job(jobid serial, jobname text, schedule text, active boolean, command text);
INSERT INTO cron.job(jobname,schedule,active,command) VALUES ('birthday','0 6 * * *',true,'SELECT public.emit_birthday_notifications()'),('other','* * * * *',true,'select 1');
CREATE SCHEMA net; CREATE TABLE net._http_response(id bigint, status_code int, error_msg text, created timestamptz default now());
INSERT INTO net._http_response VALUES (1,200,null),(2,500,null),(3,null,'timeout');
CREATE TABLE public.push_tokens(token text, user_id uuid, platform text); INSERT INTO public.push_tokens VALUES ('a',gen_random_uuid(),'android');
CREATE TABLE public.push_config(id boolean primary key default true, function_url text not null, internal_secret text not null);
INSERT INTO public.push_config VALUES (true,'https://u:R3p@ss@R3host.example/functions/v1/send-push','PLANTED_OOOO');
CREATE TABLE public.email_send_log(id uuid default gen_random_uuid(), template_name text, status text, created_at timestamptz default now(), recipient_email text);
INSERT INTO public.email_send_log(template_name,status,recipient_email) VALUES ('welcome','sent','x@y.z'),('welcome','failed','x@y.z');
CREATE TABLE public.notification_emit_log(id uuid, kind text, created_at timestamptz default now(), in_app_notification_id uuid, email_message_id text);
CREATE TABLE public.held_result_notifications(id uuid, kind text, created_at timestamptz default now());
CREATE TABLE public.ops_alarms(id serial, alarm_key text, closed_at timestamptz);
CREATE FUNCTION public.push_on_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN IF NEW.actor_id = NEW.user_id THEN RETURN NEW; END IF; PERFORM 1 FROM public.push_config; RETURN NEW; END $$;
CREATE TRIGGER trg_push_on_notification AFTER INSERT ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION public.push_on_notification();
-- review round 3 cases (none of these values may be printed)
INSERT INTO public.ops_alarms(alarm_key) VALUES ('push_fail:R3a@x.z'),('push_fail/R3b@x.z'),('mail R3c@x.z'),('R3d@x.z'),('notif_fail');
INSERT INTO cron.job(jobname,schedule,active,command) VALUES ('r3','0 1 * * *',true,'SELECT net.http_post(''https://h/x'', headers := ''{"k":"r3secretrun("}'') /* notif */');
INSERT INTO public.push_tokens VALUES ('b',gen_random_uuid(),'R3 Platform <x@y>');
INSERT INTO public.email_send_log(template_name,status,recipient_email) VALUES ('R3 tmpl x@y.z','R3 status x@y.z','r3@y.z');
