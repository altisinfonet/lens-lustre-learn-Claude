-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0140 · NOTIFICATION CENTRE N3 — the centre gate. Every new row in
-- user_notifications / admin_notifications passes the centre's decision — but
-- ONLY for a group whose switch is on for that recipient. Every switch ships
-- OFF, so today every row passes unchanged.
--
-- WHY A GATE, NOT 30 HAND-EDITED MAKERS. The makers stay as they are; the
-- centre sits in front of the two tables, so it sees every writer — SQL
-- functions, the four edge functions, anything created later — and cannot be
-- bypassed. Each group (likes_comments, follows_friends, competitions,
-- wallet_support_roles, announcements, account, admin_alerts) has its own
-- switch (notif_centre_<group>), on per recipient (staged rollout) or for
-- everyone. Removing the makers' own duplicated checks is a later clean-up,
-- once a group has been live and verified.
--
-- WHAT THE GATE DOES for a row whose type's group is live for its recipient:
--   decision says send  → the row is written; if the e-mail channel is off
--                         for this member, email_sent is set true (the e-mail
--                         trigger's first line honours that); one log row.
--   decision says skip  → the row is NOT written (self, blocked, duplicate,
--                         rate limit, in-app setting off, type off); one log
--                         row with the reasons.
--   type not registered, group off, or ANY error in the centre → the row is
--   written exactly as today (a centre fault can never lose a notification;
--   it raises a WARNING so it is never silent).
--
-- BEFORE A GROUP IS SWITCHED ON (gate condition per group, N8): a skipped row
-- returns no row to its writer, so makers using INSERT … RETURNING, edge code
-- using .insert().select().single(), and inserts with ON CONFLICT must be
-- listed and checked for that group first (N1 captures their live bodies).
--
-- Rollback: supabase/rollback/20261104_0140_notification_centre_gate_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0140_notification_centre_gate.sql
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
  IF to_regprocedure('public.notification_centre_decide(text, uuid, uuid, uuid, timestamptz, uuid)') IS NULL
     OR to_regprocedure('public.notification_centre_live(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'NC-0140-PRE-001: 20261104_0110 (the centre) is not applied on this lane';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'notification_centre_gate') THEN
    RAISE EXCEPTION 'NC-0140-PRE-002: already applied — roll back first';
  END IF;
  -- every switch must still be off: the gate must never arrive already live
  IF EXISTS (SELECT 1 FROM public.site_settings s
              WHERE s.key LIKE 'notif\_centre\_%' AND s.key <> 'notif_centre_ui'
                AND (s.value = to_jsonb('live'::text) OR jsonb_typeof(s.value) = 'object')) THEN
    RAISE EXCEPTION 'NC-0140-PRE-003: a notif_centre_* group switch is already on — switch it off before adding the gate';
  END IF;
END
$pre$;

CREATE FUNCTION public.notification_centre_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  grp       text;
  recipient uuid;
  actor     uuid;
  d         jsonb;
BEGIN
  BEGIN
    SELECT nt.group_key INTO grp FROM public.notification_types nt WHERE nt.type = NEW.type;
    IF grp IS NULL THEN
      RETURN NEW;                                            -- unregistered type: today's behaviour
    END IF;
    -- Separate statements per table: PL/pgSQL plans each statement only when
    -- it runs, so the admin path never touches NEW.user_id / NEW.actor_id,
    -- which admin_notifications does not have (a CASE would still read them).
    IF TG_TABLE_NAME = 'user_notifications' THEN
      recipient := NEW.user_id;
      actor     := NEW.actor_id;
    END IF;
    IF NOT public.notification_centre_live(grp, recipient) THEN
      RETURN NEW;                                            -- group off for this recipient: today's behaviour
    END IF;

    d := public.notification_centre_decide(NEW.type, recipient, actor, NEW.reference_id,
                                           coalesce(NEW.created_at, now()), NEW.id);

    INSERT INTO public.notification_centre_log (type, recipient_id, actor_id, reference_id, sent, reasons, channels, notification_id)
    VALUES (NEW.type, recipient, actor, NEW.reference_id, (d ->> 'send')::boolean,
            ARRAY(SELECT jsonb_array_elements_text(d -> 'reasons')), d -> 'channels',
            CASE WHEN (d ->> 'send')::boolean THEN NEW.id END);

    IF NOT (d ->> 'send')::boolean THEN
      RETURN NULL;                                           -- the centre says skip: no row, no push, no e-mail
    END IF;
    IF TG_TABLE_NAME = 'user_notifications' AND NOT coalesce((d -> 'channels' ->> 'email')::boolean, false) THEN
      NEW.email_sent := true;                                -- e-mail off for this member/type
    END IF;
    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    -- a centre fault never loses a notification — but it is never silent
    RAISE WARNING 'notification_centre_gate fault on %: % (%)', TG_TABLE_NAME, SQLERRM, SQLSTATE;
    RETURN NEW;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notification_centre_gate() FROM PUBLIC, anon, authenticated;

-- named so it fires before other BEFORE INSERT triggers (alphabetical order)
CREATE TRIGGER aaa_notification_centre_gate
  BEFORE INSERT ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public.notification_centre_gate();
CREATE TRIGGER aaa_notification_centre_gate
  BEFORE INSERT ON public.admin_notifications
  FOR EACH ROW EXECUTE FUNCTION public.notification_centre_gate();

COMMIT;
