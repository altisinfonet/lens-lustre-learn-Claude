CREATE TABLE public.user_notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, actor_id uuid, type text not null, title text not null, message text not null, reference_id uuid, is_read boolean not null default false, email_sent boolean not null default false, dedup_key text, created_at timestamptz not null default now());
CREATE TABLE public.admin_notifications(id uuid primary key default gen_random_uuid(), type text not null, title text, message text, reference_id uuid, is_read boolean not null default false, created_at timestamptz default now());
CREATE TABLE public.notification_preferences(id uuid primary key default gen_random_uuid(), user_id uuid unique, inapp_reactions boolean default true, push_enabled boolean default true, email_comments boolean default true);
CREATE TABLE public.user_blocks(blocker_id uuid, blocked_id uuid, created_at timestamptz default now());
CREATE TABLE public.posts(id uuid primary key default gen_random_uuid(), user_id uuid);
CREATE TABLE public.post_reactions(id uuid primary key default gen_random_uuid(), post_id uuid, user_id uuid);
CREATE FUNCTION public.notify_post_reaction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _owner uuid; BEGIN
  SELECT user_id INTO _owner FROM public.posts WHERE id = NEW.post_id;
  IF _owner IS NULL OR _owner = NEW.user_id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_preferences WHERE user_id=_owner AND inapp_reactions=false) THEN RETURN NEW; END IF;
  INSERT INTO public.user_notifications(user_id, actor_id, type, title, message, reference_id) VALUES (_owner, NEW.user_id, 'post_reaction','t','m',NEW.post_id);
  RETURN NEW; END $$;
CREATE TRIGGER trg_notify_post_reaction AFTER INSERT ON public.post_reactions FOR EACH ROW EXECUTE FUNCTION public.notify_post_reaction();
CREATE FUNCTION public.emit_notification(_kind text, _recipient_user_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.user_notifications(user_id,type,title,message) VALUES (_recipient_user_id,_kind,'x','y') ON CONFLICT DO NOTHING; RETURN NULL; END $$;
CREATE FUNCTION public.award_badge(_u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM public.emit_notification('badge', _u); END $$;
CREATE FUNCTION public.notify_secret_thing() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 'Bearer PLANTED-MARKER-AAAAAAAAAAAAAAAAAAAAAA'; INSERT INTO public.admin_notifications(type) VALUES ('x'); END $$;
-- data
INSERT INTO public.posts(id,user_id) SELECT gen_random_uuid(), gen_random_uuid() FROM generate_series(1,3);
INSERT INTO public.post_reactions(post_id,user_id) SELECT p.id, gen_random_uuid() FROM public.posts p, generate_series(1,4);
INSERT INTO public.post_reactions(post_id,user_id) SELECT id, user_id FROM public.posts; -- self, skipped
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message) SELECT u, u, 'self_type','t','m' FROM (SELECT gen_random_uuid() u) s;
INSERT INTO public.user_blocks SELECT user_id, actor_id FROM public.user_notifications WHERE type='post_reaction' LIMIT 1;
INSERT INTO public.admin_notifications(type) VALUES ('new_ticket'),('new_ticket');
INSERT INTO public.notification_preferences(user_id, push_enabled) VALUES (gen_random_uuid(), false);
-- review bypass cases (each must be WITHHELD, never printed)
CREATE FUNCTION public.notify_bypass_assign() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v_secret text; BEGIN v_secret := 'PLANTED_BBBBBBBB'; INSERT INTO public.user_notifications(user_id,type,title,message) VALUES (gen_random_uuid(),'x','t','m'); END $$;
CREATE FUNCTION public.notify_bypass_declare() RETURNS void LANGUAGE plpgsql AS $$ DECLARE _push_token text := 'PLANTED_CCCCCCCC'; BEGIN NULL; END $$;
CREATE FUNCTION public.notify_bypass_b64key() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 'PLANTEDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'; END $$;
CREATE FUNCTION public.notify_bypass_email() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 'admin@example.org'; END $$;
CREATE FUNCTION public.notify_bypass_uuid() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM '0b5e2a8c-1d3f-4e6a-9b7c-2f4d6e8a0c1e'::uuid; END $$;
-- SQL-standard body (prosrc empty) and a procedure: must still be listed
CREATE FUNCTION public.notif_count_atomic(u uuid) RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM public.user_notifications WHERE user_id = u; END;
CREATE PROCEDURE public.notify_proc_admin() LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.admin_notifications(type) VALUES ('p'); END $$;
-- duplicates: one busy recipient, 5 identical rows 10 s apart -> 4 duplicate ROWS
INSERT INTO public.user_notifications(user_id, actor_id, type, title, message, reference_id, created_at)
SELECT '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'dup_type', 't', 'm', NULL, now() - (g * interval '10 seconds') FROM generate_series(1,5) g;
-- review round 2 bypass cases (no body text may ever be printed)
CREATE FUNCTION public.notify_r2_json() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM '{"Content-Type":"application/json","x-api-key":"PLANTED_EEEE"}'::jsonb; END $$;
CREATE FUNCTION public.notify_r2_const() RETURNS void LANGUAGE plpgsql AS $$ DECLARE c_secret CONSTANT text := 'PLANTED_FFFF'; _key text DEFAULT 'PLANTED_GGGG'; BEGIN NULL; END $$;
CREATE FUNCTION public.notify_r2_estr() RETURNS void LANGUAGE plpgsql AS $$ DECLARE v_secret text := E'PLANTED_HHHH'; BEGIN NULL; END $$;
CREATE FUNCTION public.notify_r2_hdr() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM jsonb_build_object('x-hook-signature', 'PLANTED_IIII'); END $$;
CREATE FUNCTION public.notify_r2_comment() RETURNS void LANGUAGE plpgsql AS $$ BEGIN -- old pw PLANTED_JJJJ
NULL; END $$;
-- a trigger with an argument and a WHEN clause holding literals; a partial index; a literal default
CREATE FUNCTION public.notify_trg_args() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.admin_notifications(type) VALUES (TG_ARGV[0]); RETURN NEW; END $$;
CREATE TRIGGER trg_args AFTER INSERT ON public.posts FOR EACH ROW WHEN (NEW.user_id = 'aaaaaaaa-0000-0000-0000-00000000beef') EXECUTE FUNCTION public.notify_trg_args('PLANTED_KKKK');
CREATE INDEX un_partial ON public.user_notifications(user_id) WHERE type = 'PLANTED_LLLL';
ALTER TABLE public.admin_notifications ALTER COLUMN title SET DEFAULT 'PLANTED_MMMM';
-- review round 3: an index expression literal and a free-text type label
CREATE INDEX un_expr ON public.user_notifications ((coalesce(dedup_key, 'PLANTED_NNNN')));
INSERT INTO public.user_notifications(user_id, type, title, message) VALUES (gen_random_uuid(), 'R3 type x@y.z', 't', 'm');
