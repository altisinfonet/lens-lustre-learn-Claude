-- ROLLBACK · 20261118_3600 · M26 broadcast extras
-- Removes announcement-only, templates and the welcome message, and puts the broadcast audience back as it was
-- (which ignores the chat switch again). Welcome messages already delivered stay in the boxes.
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
END
$lane_guard$;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS messages_welcome_queue_insert ON public.profiles;
DROP FUNCTION IF EXISTS public.messages_welcome_queue();
DELETE FROM public.jobs WHERE kind = 'message.welcome' AND status = 'queued';
DELETE FROM public.job_kinds WHERE kind = 'message.welcome' AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.kind = 'message.welcome');
DROP FUNCTION IF EXISTS public.message_welcome_send(jsonb);
DROP FUNCTION IF EXISTS public.admin_message_welcome_set(boolean, text, boolean);
DROP FUNCTION IF EXISTS public.admin_message_welcome_get();
DROP TABLE IF EXISTS public.message_welcome;

DROP FUNCTION IF EXISTS public.admin_message_template_delete(bigint);
DROP FUNCTION IF EXISTS public.admin_message_template_save(text, text, jsonb);
DROP FUNCTION IF EXISTS public.admin_message_templates();
DROP TABLE IF EXISTS public.message_broadcast_templates;

DROP TRIGGER IF EXISTS messages_announcement_guard_insert ON public.messages;
DROP FUNCTION IF EXISTS public.messages_announcement_guard();
DROP FUNCTION IF EXISTS public.admin_message_broadcast_unlock(bigint);

DO $patch$
DECLARE
  _f text; _def text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['public.admin_message_broadcast_audience(jsonb)', 'public.admin_message_broadcast_send(bigint,timestamptz)'] LOOP
    _def := pg_get_functiondef(_f::regprocedure);
    EXECUTE replace(_def, 'public.account_can_act(a.member_id) AND public.message_control_allows(a.member_id)', 'public.account_can_act(a.member_id)');
  END LOOP;

  _def := pg_get_functiondef('public.admin_message_broadcast_save(bigint,jsonb)'::regprocedure);
  _def := replace(_def, '_push boolean := coalesce((_fields ->> ''push'')::boolean, true);
  _ann boolean := coalesce((_fields ->> ''announcement_only'')::boolean, false);', '_push boolean := coalesce((_fields ->> ''push'')::boolean, true);');
  _def := replace(_def, 'INSERT INTO public.message_broadcasts (title, body, photos, audience, push, sender_id, created_by, announcement_only)
    VALUES (_title, _body, _photos, _aud, _push, _uid, _uid, _ann) RETURNING id INTO _out;', 'INSERT INTO public.message_broadcasts (title, body, photos, audience, push, sender_id, created_by)
    VALUES (_title, _body, _photos, _aud, _push, _uid, _uid) RETURNING id INTO _out;');
  _def := replace(_def, 'audience = _aud, push = _push, announcement_only = _ann, updated_at = now()', 'audience = _aud, push = _push, updated_at = now()');
  EXECUTE _def;

  _def := pg_get_functiondef('public.message_broadcast_run_batch(jsonb)'::regprocedure);
  EXECUTE replace(_def, '
      IF c.announcement_only THEN UPDATE public.conversations SET announcement_only = true WHERE id = _conv; END IF;', '');

  _def := pg_get_functiondef('public.message_my_conversations(text,integer,timestamptz)'::regprocedure);
  EXECUTE replace(_def, '
               ''announcement_only'', (c.announcement_only AND cm.role <> ''owner''),', '');
END
$patch$;

ALTER TABLE public.conversations DROP COLUMN IF EXISTS announcement_only;
ALTER TABLE public.message_broadcasts DROP COLUMN IF EXISTS announcement_only;

COMMIT;
