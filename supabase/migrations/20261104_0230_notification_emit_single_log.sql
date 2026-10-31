-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0230 · NOTIFICATION CENTRE — one log row per notification.
--
-- Found by the review of #792 (the first real caller of emit since the gate):
-- a notification sent by notification_centre_emit was logged twice — once by
-- the gate (0140, BEFORE INSERT) and once by emit itself — so the admin
-- page's "centre sent" numbers would read double for emit-sent types. The
-- push trigger was never affected (it reads the gate's row).
--
-- CHANGE: emit logs only what it SKIPS (no insert, so the gate never runs);
-- a sent row is logged by the gate. On a table without the gate, emit logs
-- everything, as before. notification_centre_decide is NOT touched (the N2
-- shadow replays decide, so its gate is unaffected). Every switch is off.
--
-- PRE pins the 0110 emit body (md5 b4c9741e…); rollback restores it.
-- Rollback: supabase/rollback/20261104_0230_notification_emit_single_log_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0230_notification_emit_single_log.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)'))
     IS DISTINCT FROM 'b4c9741ebc80d108ba464d33b7503d7a' THEN
    RAISE EXCEPTION 'NC-0230-PRE-001: live notification_centre_emit is not the 0110 body — re-measure before changing it';
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

  -- One log row per notification (20261104_0230). A row emit sends goes
  -- through the gate (0140), which logs it — so emit logs only what it skips
  -- (nothing is inserted, the gate never sees it). Without the gate on the
  -- target table (a lane before 0140), emit logs everything, as before.
  -- Also log a row emit inserted when the gate left no log row for it (a
  -- fault inside the gate, or its live check differing from emit's), so a
  -- sent notification is never left without one.
  IF NOT (d ->> 'send')::boolean
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tg
                     WHERE tg.tgname = 'aaa_notification_centre_gate' AND NOT tg.tgisinternal AND tg.tgenabled <> 'D'
                       AND tg.tgrelid = CASE WHEN t.audience = 'member' THEN 'public.user_notifications'::regclass
                                             ELSE 'public.admin_notifications'::regclass END)
     OR (nid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.notification_centre_log l WHERE l.notification_id = nid)) THEN
    INSERT INTO public.notification_centre_log (type, recipient_id, actor_id, reference_id, sent, reasons, channels, notification_id)
    VALUES (_type, _recipient, _actor, _reference, (d ->> 'send')::boolean,
            ARRAY(SELECT jsonb_array_elements_text(d -> 'reasons')), d -> 'channels', nid);
  END IF;
  RETURN nid;
END;
$fn$;

COMMIT;
