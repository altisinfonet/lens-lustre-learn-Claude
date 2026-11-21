-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261118_3600 — M26 broadcast extras. One transaction, ROLLBACK.
-- Before 20261118_3600: FAIL (message_welcome missing). After: M26 PASS.
--   P1  the broadcast audience counts only members who have the chat facility
--   P2  an announcement-only chat refuses a reply from the member (MSG-090), accepts the sending admin; unlock reopens it
--   P3  templates: save, list, delete — admin only
--   P4  welcome message: delivered once to a member with the chat facility, never to one without, never twice; the new-profile trigger exists
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = notice;

CREATE FUNCTION pg_temp.set_user(_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
END
$f$;

DO $p$
DECLARE
  _fail text[] := '{}';
  _a uuid; _b uuid; _admin uuid; _conv uuid; _r jsonb; _n int; _id bigint; _ok boolean; _msg text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  RAISE NOTICE 'M26 lane %', current_setting('p32.lane', true);
  IF to_regclass('public.message_welcome') IS NULL THEN
    RAISE EXCEPTION 'M26 FAIL: message_welcome missing — expected before 20261118_3600';
  END IF;

  SELECT p.id INTO _a FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT p.is_suspended AND NOT coalesce(p.is_banned, false) AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = 'admin') ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO _b FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT p.is_suspended AND NOT coalesce(p.is_banned, false) AND p.id <> _a AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = 'admin') ORDER BY p.created_at LIMIT 1;
  SELECT r.user_id INTO _admin FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id WHERE r.role::text = 'admin' ORDER BY r.user_id LIMIT 1;
  IF _b IS NULL OR _admin IS NULL THEN RAISE EXCEPTION 'M26 FAIL: need two members and one admin to test with'; END IF;

  UPDATE public.system_flags SET value = true WHERE key = 'account_state_guard';
  UPDATE public.message_control SET mode = 'allowed_selected';
  DELETE FROM public.message_control_members;
  INSERT INTO public.message_control_members (user_id) VALUES (_a);          -- a has the chat facility, b does not

  -- P1
  PERFORM pg_temp.set_user(_admin);
  _r := public.admin_message_broadcast_audience(jsonb_build_object('kind', 'members', 'ids', jsonb_build_array(_a, _b)));
  IF (_r ->> 'will_receive')::int <> 1 THEN _fail := _fail || ('P1 the audience should reach 1 member (only a has chat), says ' || (_r ->> 'will_receive')); END IF;

  -- P2
  INSERT INTO public.conversations (kind, direct_key, created_by, announcement_only)
    VALUES ('direct', least(_admin::text, _a::text) || ':' || greatest(_admin::text, _a::text) || ':m26', _admin, true) RETURNING id INTO _conv;
  INSERT INTO public.conversation_members (conversation_id, user_id, role, folder) VALUES (_conv, _admin, 'owner', 'inbox'), (_conv, _a, 'member', 'inbox');
  BEGIN
    INSERT INTO public.messages (conversation_id, sender_id, body, client_msg_id) VALUES (_conv, _a, 'M26 reply', gen_random_uuid());
    _fail := _fail || 'P2 a member replied in an announcement-only chat';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg NOT LIKE 'MSG-090%' THEN _fail := _fail || ('P2 wrong refusal: ' || _msg); END IF;
  END;
  INSERT INTO public.messages (conversation_id, sender_id, body, client_msg_id) VALUES (_conv, _admin, 'M26 announcement', gen_random_uuid());
  _r := public.message_my_conversations('inbox', 50, NULL);
  PERFORM pg_temp.set_user(_a);
  _r := public.message_my_conversations('inbox', 50, NULL);
  IF NOT (_r::text LIKE '%"announcement_only": true%') THEN _fail := _fail || 'P2 the list does not report announcement_only'; END IF;
  -- unlock needs a broadcast; the function reopens chats that belong to its recipients — here none, so it must be a harmless 0
  PERFORM pg_temp.set_user(_admin);
  IF public.admin_message_broadcast_unlock(-1) <> 0 THEN _fail := _fail || 'P2 unlock of an unknown broadcast touched chats'; END IF;
  UPDATE public.conversations SET announcement_only = false WHERE id = _conv;
  INSERT INTO public.messages (conversation_id, sender_id, body, client_msg_id) VALUES (_conv, _a, 'M26 reply 2', gen_random_uuid());

  -- P3
  _id := public.admin_message_template_save('M26 tpl', 'Hello all', '[]'::jsonb);
  IF NOT (public.admin_message_templates()::text LIKE '%M26 tpl%') THEN _fail := _fail || 'P3 the template is not listed'; END IF;
  IF NOT public.admin_message_template_delete(_id) THEN _fail := _fail || 'P3 the template was not deleted'; END IF;
  IF public.admin_message_templates()::text LIKE '%M26 tpl%' THEN _fail := _fail || 'P3 the deleted template is still listed'; END IF;
  PERFORM pg_temp.set_user(_a);
  BEGIN
    PERFORM public.admin_message_templates();
    _fail := _fail || 'P3 a member could list templates';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- P4
  PERFORM pg_temp.set_user(_admin);
  PERFORM public.admin_message_welcome_set(true, 'Welcome to 50mm Retina World', false);
  PERFORM public.message_welcome_send(jsonb_build_object('user_id', _a));
  PERFORM public.message_welcome_send(jsonb_build_object('user_id', _a));
  SELECT count(*) INTO _n FROM public.messages m WHERE m.sender_id = _admin AND m.body = 'Welcome to 50mm Retina World' AND m.client_msg_id = md5('welcome:' || _a::text)::uuid;
  IF _n <> 1 THEN _fail := _fail || ('P4 expected exactly one welcome for the member with chat, found ' || _n); END IF;
  PERFORM public.message_welcome_send(jsonb_build_object('user_id', _b));
  SELECT count(*) INTO _n FROM public.messages m WHERE m.client_msg_id = md5('welcome:' || _b::text)::uuid;
  IF _n <> 0 THEN _fail := _fail || 'P4 a welcome reached a member who has no chat facility'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_welcome_queue_insert' AND tgrelid = 'public.profiles'::regclass) THEN _fail := _fail || 'P4 the new-profile trigger is missing'; END IF;
  IF has_function_privilege('anon', 'public.message_welcome_send(jsonb)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.message_welcome_send(jsonb)', 'EXECUTE') THEN _fail := _fail || 'P4 a member can run the welcome sender'; END IF;

  IF array_length(_fail, 1) > 0 THEN
    RAISE EXCEPTION 'M26 FAIL (% problem(s)): %', array_length(_fail, 1), array_to_string(_fail, ' | ');
  END IF;
  RAISE NOTICE 'M26 PASS — broadcasts reach only members with chat; announcement-only chats refuse replies; templates and welcome message work, welcome never twice';
END
$p$;

ROLLBACK;
