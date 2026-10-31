-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0230 — restores the 0110 notification_centre_emit body
-- byte for byte (md5 b4c9741e…). Refuses unless 0230 is live.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)'))
     IS DISTINCT FROM '863c541252b3885063958f3f9ea506d5' THEN
    RAISE EXCEPTION 'NC-0230-RB-PRE-001: 20261104_0230 is not what is live — nothing to roll back';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.notification_centre_emit(
  _type text, _recipient uuid, _actor uuid, _reference uuid,
  _title text, _message text, _dedup_key text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  t   public.notification_types%ROWTYPE;
  d   jsonb;
  nid uuid;
BEGIN
  SELECT * INTO t FROM public.notification_types nt WHERE nt.type = _type;
  IF NOT FOUND OR NOT public.notification_centre_live(t.group_key, _recipient) THEN
    RETURN NULL;
  END IF;

  -- two emits for the same (type, recipient, reference) at once must not both
  -- pass the duplicate check: serialise them for this transaction
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'notif:' || _type || ':' || coalesce(_recipient::text, '-') || ':' || coalesce(_reference::text, '-'), 0));

  d := public.notification_centre_decide(_type, _recipient, _actor, _reference, now(), NULL);

  IF (d ->> 'send')::boolean THEN
    IF t.audience = 'member' THEN
      INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id, dedup_key, email_sent)
      VALUES (_recipient, _actor, _type, _title, _message, _reference, _dedup_key,
              NOT coalesce((d -> 'channels' ->> 'email')::boolean, false))
      RETURNING id INTO nid;
    ELSE
      INSERT INTO public.admin_notifications (type, title, message, reference_id)
      VALUES (_type, _title, _message, _reference)
      RETURNING id INTO nid;
    END IF;
  END IF;

  INSERT INTO public.notification_centre_log (type, recipient_id, actor_id, reference_id, sent, reasons, channels, notification_id)
  VALUES (_type, _recipient, _actor, _reference, (d ->> 'send')::boolean,
          ARRAY(SELECT jsonb_array_elements_text(d -> 'reasons')), d -> 'channels', nid);
  RETURN nid;
END;
$fn$;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)'))
     IS DISTINCT FROM 'b4c9741ebc80d108ba464d33b7503d7a' THEN
    RAISE EXCEPTION 'NC-0230-RB-POST-001: restored emit does not match the 0110 md5';
  END IF;
END
$post$;

COMMIT;
