-- ═══════════════════════════════════════════════════════════════════════════
-- 20261118_3600 · M26 — Broadcast extras (Owner list 21 Nov 2026): announcement-only, templates, welcome message
--                       + a fix: a broadcast must only reach members who HAVE the chat facility
--
--  0. FIX. The broadcast audience (count and send snapshot) ignored the admin chat switch, so "all members" would have put a
--     message into the box of a member who has no chat facility. Both now also require message_control_allows(member).
--  1. Announcement only. message_broadcasts.announcement_only; the batch marks each chat it writes into
--     (conversations.announcement_only). A trigger on messages then refuses a reply from anyone but the chat's owner (the
--     sending admin) with MSG-090. admin_message_broadcast_unlock(id) opens those chats for replies again.
--     message_my_conversations also reports the flag so the app can show "Only 50mm Retina World can write here".
--  2. Templates. message_broadcast_templates (title, body, pictures) with admin_message_templates / _template_save / _template_delete.
--  3. Welcome message. message_welcome (one row: on/off, text, push) with admin_message_welcome_get / _set. A trigger on a NEW
--     profile queues job message.welcome 5 minutes later; message_welcome_send writes the message from the sending admin into
--     the new member's box — only if the welcome is on AND that member has the chat facility. Never twice for a member.
--
-- Rollback: supabase/rollback/20261118_3600_m26_broadcast_extras_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261118_3600_m26_broadcast_extras.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
  IF to_regprocedure('public.message_can_reach(uuid)') IS NULL THEN
    RAISE EXCEPTION 'M26-PRE-001: 20261118_2910 is not applied';
  END IF;
  IF to_regclass('public.message_welcome') IS NOT NULL THEN
    RAISE EXCEPTION 'M26-PRE-002: message_welcome already exists — not re-applying';
  END IF;
END
$lane_guard$;
SET LOCAL lock_timeout = '5s';

-- ── 0. broadcasts only reach members who have the chat facility ────────────
DO $patch$
DECLARE
  _f text; _def text;
  _old constant text := 'public.account_can_act(a.member_id)';
  _new constant text := 'public.account_can_act(a.member_id) AND public.message_control_allows(a.member_id)';
BEGIN
  FOREACH _f IN ARRAY ARRAY['public.admin_message_broadcast_audience(jsonb)', 'public.admin_message_broadcast_send(bigint,timestamptz)'] LOOP
    _def := pg_get_functiondef(_f::regprocedure);
    IF position(_old IN _def) = 0 THEN RAISE EXCEPTION 'M26-PRE-003: the member check of % was not found — nothing patched', _f; END IF;
    EXECUTE replace(_def, _old, _new);
  END LOOP;
END
$patch$;

-- ── 1. announcement only ───────────────────────────────────────────────────
ALTER TABLE public.message_broadcasts ADD COLUMN announcement_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations ADD COLUMN announcement_only boolean NOT NULL DEFAULT false;

DO $patch$
DECLARE
  _def text;
  _old1 constant text := '_push boolean := coalesce((_fields ->> ''push'')::boolean, true);';
  _new1 constant text := '_push boolean := coalesce((_fields ->> ''push'')::boolean, true);
  _ann boolean := coalesce((_fields ->> ''announcement_only'')::boolean, false);';
  _old2 constant text := 'INSERT INTO public.message_broadcasts (title, body, photos, audience, push, sender_id, created_by)
    VALUES (_title, _body, _photos, _aud, _push, _uid, _uid) RETURNING id INTO _out;';
  _new2 constant text := 'INSERT INTO public.message_broadcasts (title, body, photos, audience, push, sender_id, created_by, announcement_only)
    VALUES (_title, _body, _photos, _aud, _push, _uid, _uid, _ann) RETURNING id INTO _out;';
  _old3 constant text := 'audience = _aud, push = _push, updated_at = now()';
  _new3 constant text := 'audience = _aud, push = _push, announcement_only = _ann, updated_at = now()';
  _old4 constant text := 'INSERT INTO public.conversation_members (conversation_id, user_id, role, folder) VALUES (_conv, r.user_id, ''member'', ''inbox'') ON CONFLICT DO NOTHING;';
  _new4 constant text := 'INSERT INTO public.conversation_members (conversation_id, user_id, role, folder) VALUES (_conv, r.user_id, ''member'', ''inbox'') ON CONFLICT DO NOTHING;
      IF c.announcement_only THEN UPDATE public.conversations SET announcement_only = true WHERE id = _conv; END IF;';
  _old5 constant text := '''muted'', cm.muted,';
  _new5 constant text := '''muted'', cm.muted,
               ''announcement_only'', (c.announcement_only AND cm.role <> ''owner''),';
BEGIN
  _def := pg_get_functiondef('public.admin_message_broadcast_save(bigint,jsonb)'::regprocedure);
  IF position(_old1 IN _def) = 0 OR position(_old2 IN _def) = 0 OR position(_old3 IN _def) = 0 THEN RAISE EXCEPTION 'M26-PRE-004: admin_message_broadcast_save has an unexpected shape — nothing patched'; END IF;
  EXECUTE replace(replace(replace(_def, _old1, _new1), _old2, _new2), _old3, _new3);

  _def := pg_get_functiondef('public.message_broadcast_run_batch(jsonb)'::regprocedure);
  IF position(_old4 IN _def) = 0 THEN RAISE EXCEPTION 'M26-PRE-005: message_broadcast_run_batch has an unexpected shape — nothing patched'; END IF;
  EXECUTE replace(_def, _old4, _new4);

  _def := pg_get_functiondef('public.message_my_conversations(text,integer,timestamptz)'::regprocedure);
  IF position(_old5 IN _def) = 0 THEN RAISE EXCEPTION 'M26-PRE-006: message_my_conversations has an unexpected shape — nothing patched'; END IF;
  EXECUTE replace(_def, _old5, _new5);
END
$patch$;

CREATE FUNCTION public.messages_announcement_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = NEW.conversation_id AND c.announcement_only)
     AND NOT EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = NEW.conversation_id AND m.user_id = NEW.sender_id AND m.role = 'owner') THEN
    RAISE EXCEPTION 'MSG-090: only the sender can write in this chat' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.messages_announcement_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER messages_announcement_guard_insert BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_announcement_guard();

CREATE FUNCTION public.admin_message_broadcast_unlock(_id bigint)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE _uid uuid := public.message_broadcast_admin(); _n integer;
BEGIN
  UPDATE public.conversations c SET announcement_only = false
   WHERE c.announcement_only AND c.id IN (SELECT r.conversation_id FROM public.message_broadcast_recipients r WHERE r.broadcast_id = _id AND r.conversation_id IS NOT NULL);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_message_broadcast_unlock(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_broadcast_unlock(bigint) TO authenticated, service_role;

-- ── 2. templates ───────────────────────────────────────────────────────────
CREATE TABLE public.message_broadcast_templates (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  photos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- P28: message_broadcast_templates · a handful of rows · listed newest first on the broadcast screen
CREATE INDEX message_broadcast_templates_recent_idx ON public.message_broadcast_templates (created_at DESC);
ALTER TABLE public.message_broadcast_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_broadcast_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.message_broadcast_templates TO service_role;

CREATE FUNCTION public.admin_message_templates()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE _uid uuid := public.message_broadcast_admin();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'body', t.body, 'photos', t.photos, 'created_at', t.created_at) ORDER BY t.created_at DESC)
                     FROM (SELECT * FROM public.message_broadcast_templates ORDER BY created_at DESC LIMIT 50) t), '[]'::jsonb);
END
$fn$;

CREATE FUNCTION public.admin_message_template_save(_title text, _body text, _photos jsonb DEFAULT '[]'::jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE _uid uuid := public.message_broadcast_admin(); _out bigint;
BEGIN
  IF btrim(coalesce(_title, '')) = '' OR char_length(_title) > 120 THEN RAISE EXCEPTION 'MSGBC-002: a template title of 1–120 characters is required' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF char_length(coalesce(_body, '')) > 4000 THEN RAISE EXCEPTION 'MSGBC-002: the message is longer than 4000 characters' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF jsonb_typeof(coalesce(_photos, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(_photos, '[]'::jsonb)) > 10 THEN RAISE EXCEPTION 'MSGBC-002: at most 10 pictures' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF (SELECT count(*) FROM public.message_broadcast_templates) >= 200 THEN RAISE EXCEPTION 'MSGBC-002: 200 templates is the limit — delete one first' USING ERRCODE = 'invalid_parameter_value'; END IF;
  INSERT INTO public.message_broadcast_templates (title, body, photos, created_by) VALUES (btrim(_title), coalesce(_body, ''), coalesce(_photos, '[]'::jsonb), _uid) RETURNING id INTO _out;
  RETURN _out;
END
$fn$;

CREATE FUNCTION public.admin_message_template_delete(_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE _uid uuid := public.message_broadcast_admin();
BEGIN
  DELETE FROM public.message_broadcast_templates WHERE id = _id;
  RETURN FOUND;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_message_templates() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_message_template_save(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_message_template_delete(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_templates(), public.admin_message_template_save(text, text, jsonb), public.admin_message_template_delete(bigint) TO authenticated, service_role;

-- ── 3. welcome message ─────────────────────────────────────────────────────
CREATE TABLE public.message_welcome (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),         -- one row only
  enabled     boolean NOT NULL DEFAULT false,
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  push        boolean NOT NULL DEFAULT false,
  sender_id   uuid,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.message_welcome (id) VALUES (true);
ALTER TABLE public.message_welcome ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_welcome FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.message_welcome TO service_role;

CREATE FUNCTION public.admin_message_welcome_get()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE _uid uuid := public.message_broadcast_admin();
BEGIN
  RETURN (SELECT jsonb_build_object('enabled', w.enabled, 'body', w.body, 'push', w.push, 'sender_id', w.sender_id, 'updated_at', w.updated_at) FROM public.message_welcome w);
END
$fn$;

CREATE FUNCTION public.admin_message_welcome_set(_enabled boolean, _body text, _push boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE _uid uuid := public.message_broadcast_admin();
BEGIN
  IF char_length(coalesce(_body, '')) > 4000 THEN RAISE EXCEPTION 'MSGBC-002: the message is longer than 4000 characters' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF coalesce(_enabled, false) AND btrim(coalesce(_body, '')) = '' THEN RAISE EXCEPTION 'MSGBC-002: write the welcome message before switching it on' USING ERRCODE = 'invalid_parameter_value'; END IF;
  UPDATE public.message_welcome SET enabled = coalesce(_enabled, false), body = btrim(coalesce(_body, '')), push = coalesce(_push, false), sender_id = _uid, updated_by = _uid, updated_at = now();
  RETURN public.admin_message_welcome_get();
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_message_welcome_get() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_message_welcome_set(boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_welcome_get(), public.admin_message_welcome_set(boolean, text, boolean) TO authenticated, service_role;

CREATE FUNCTION public.message_welcome_send(_p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  _u uuid := nullif(_p ->> 'user_id', '')::uuid;
  w public.message_welcome;
  _dkey text; _conv uuid; _key uuid;
BEGIN
  SELECT * INTO w FROM public.message_welcome;
  IF _u IS NULL OR NOT w.enabled OR btrim(w.body) = '' OR w.sender_id IS NULL OR _u = w.sender_id THEN RETURN; END IF;
  -- only members who have the chat facility (Owner rule); nobody else is pulled into the feature
  IF NOT (public.account_can_act(_u) AND public.message_control_allows(_u)) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks ub WHERE (ub.blocker_id = w.sender_id AND ub.blocked_id = _u) OR (ub.blocker_id = _u AND ub.blocked_id = w.sender_id)) THEN RETURN; END IF;
  _key := md5('welcome:' || _u::text)::uuid;
  IF EXISTS (SELECT 1 FROM public.messages m WHERE m.sender_id = w.sender_id AND m.client_msg_id = _key) THEN RETURN; END IF;
  PERFORM set_config('messages.skip_push', CASE WHEN w.push THEN 'off' ELSE 'on' END, true);
  _dkey := least(w.sender_id::text, _u::text) || ':' || greatest(w.sender_id::text, _u::text);
  INSERT INTO public.conversations (kind, direct_key, created_by) VALUES ('direct', _dkey, w.sender_id) ON CONFLICT (direct_key) DO NOTHING RETURNING id INTO _conv;
  IF _conv IS NULL THEN SELECT cv.id INTO _conv FROM public.conversations cv WHERE cv.direct_key = _dkey; END IF;
  INSERT INTO public.conversation_members (conversation_id, user_id, role, folder) VALUES (_conv, w.sender_id, 'owner', 'inbox') ON CONFLICT DO NOTHING;
  INSERT INTO public.conversation_members (conversation_id, user_id, role, folder) VALUES (_conv, _u, 'member', 'inbox') ON CONFLICT DO NOTHING;
  IF (SELECT cm.folder FROM public.conversation_members cm WHERE cm.conversation_id = _conv AND cm.user_id = _u) = 'declined' THEN RETURN; END IF;
  INSERT INTO public.messages (conversation_id, sender_id, kind, body, client_msg_id) VALUES (_conv, w.sender_id, 'text', w.body, _key) ON CONFLICT (sender_id, client_msg_id) DO NOTHING;
  UPDATE public.conversations SET last_message_at = now() WHERE id = _conv;
END
$fn$;
REVOKE ALL ON FUNCTION public.message_welcome_send(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_welcome_send(jsonb) TO service_role;

INSERT INTO public.job_kinds (kind, handler, max_attempts, backoff_seconds, timeout_seconds, max_running, note)
VALUES ('message.welcome', 'sql:public.message_welcome_send', 3, ARRAY[300, 1800], 60, 5,
        'M26: one welcome message per new member (key welcome:<user id>), queued 5 minutes after the profile is created');

CREATE FUNCTION public.messages_welcome_queue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF coalesce((SELECT f.value FROM public.system_flags f WHERE f.key = 'job_engine'), false)
     AND coalesce((SELECT w.enabled FROM public.message_welcome w), false) THEN
    BEGIN
      PERFORM public.job_enqueue('message.welcome', jsonb_build_object('user_id', NEW.id), 'welcome:' || NEW.id::text, now() + interval '5 minutes');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'messages_welcome_queue: could not queue the welcome for % (%)', NEW.id, SQLSTATE;
    END;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.messages_welcome_queue() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER messages_welcome_queue_insert AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.messages_welcome_queue();

COMMIT;
