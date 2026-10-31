-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0220 · NOTIFICATION CENTRE N6 — push an announcement to a chosen
-- group, from Admin → Notification Centre.
--
-- A new registry type, admin_announcement (group "announcements", bell +
-- push, the member's "Announcements" phone switch governs the push), sent
-- ONLY through the centre's own write path (notification_centre_emit). So it
-- obeys the Announcements switch exactly like every other type: while that
-- row is Off for a member, nothing reaches them. The staged rollout (only me
-- → chosen members → everyone) and every member setting apply automatically.
--
--   admin_notif_announce(title, message, who, members)  admins only
--     who: 'me' | 'members' (the chosen ids, ≤ 500) | 'everyone'
--     title 1–80 characters, message 1–300; at most one announcement every
--     10 minutes (all admins together); recorded in the change history.
--     At most 3000 recipients per call: the centre's emit holds one lock per
--     member until the end of the call, and an unbounded "everyone" ran the
--     database out of shared memory in testing (20 000 members). Above the
--     limit the call is refused with a plain message. Chosen ids must be
--     live (not suspended) members. Returns {sent, asked}.
--
-- min(notification_types.seeded_at) anchors the N2 shadow window, so a row
-- added now cannot move it.
-- Rollback: supabase/rollback/20261104_0220_notification_admin_announce_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0220_notification_admin_announce.sql
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
  IF to_regprocedure('public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)') IS NULL
     OR to_regprocedure('public.notif_admin_or_raise()') IS NULL
     OR to_regclass('public.notification_centre_changes') IS NULL THEN
    RAISE EXCEPTION 'NC-0220-PRE-001: the centre (0110) and its admin page (0120) must be applied first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_types WHERE type = 'admin_announcement')
     OR to_regprocedure('public.admin_notif_announce(text, text, text, uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'NC-0220-PRE-002: already applied — roll back first';
  END IF;
END
$pre$;

INSERT INTO public.notification_types
  (type, audience, group_key, wording_key, icon, channels, member_can_disable,
   pref_in_app, pref_push, pref_email, group_by, dedup_window, rate_per_hour)
VALUES
  ('admin_announcement', 'member', 'announcements', 'notif.type.admin_announcement', 'megaphone',
   ARRAY['in_app', 'push'], true, NULL, 'push_announcements', NULL, 'none', interval '0', NULL);

CREATE FUNCTION public.admin_notif_announce(_title text, _message text, _who text, _members uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _uid   uuid := public.notif_admin_or_raise();
  _batch text := replace(gen_random_uuid()::text, '-', '');
  _r     uuid;
  _sent  integer := 0;
  _total integer := 0;
BEGIN
  _title := btrim(coalesce(_title, ''));
  _message := btrim(coalesce(_message, ''));
  IF length(_title) NOT BETWEEN 1 AND 80 OR length(_message) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'a title of 1–80 characters and a message of 1–300 are needed' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _who IS NULL OR _who NOT IN ('me', 'members', 'everyone') THEN
    RAISE EXCEPTION 'who must be me, members or everyone' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _who = 'members' AND coalesce(cardinality(_members), 0) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'choose between 1 and 500 members' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- one announcement every 10 minutes, all admins together
  PERFORM pg_advisory_xact_lock(hashtextextended('notif:admin_announce', 0));
  IF EXISTS (SELECT 1 FROM public.notification_centre_changes c
              WHERE c.subject = 'admin_announcement' AND c.field = 'sent'
                AND c.changed_at > now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'an announcement went out less than 10 minutes ago — please wait' USING ERRCODE = 'check_violation';
  END IF;

  -- who it would reach (live members only), counted BEFORE anything is sent
  SELECT count(*) INTO _total FROM public.profiles p
   WHERE coalesce(p.is_suspended, false) = false
     AND ((_who = 'me' AND p.id = _uid) OR (_who = 'members' AND p.id = ANY (_members)) OR _who = 'everyone');
  IF _total > 3000 THEN
    RAISE EXCEPTION 'that would reach % members — more than 3000 at once is not safe; send to chosen members instead', _total
      USING ERRCODE = 'program_limit_exceeded';
  END IF;
  _total := 0;

  FOR _r IN
    SELECT p.id FROM public.profiles p
     WHERE coalesce(p.is_suspended, false) = false
       AND ((_who = 'me' AND p.id = _uid) OR (_who = 'members' AND p.id = ANY (_members)) OR _who = 'everyone')
     ORDER BY p.id
  LOOP
    _total := _total + 1;
    -- no actor: an announcement is not a person acting on the member (with
    -- the admin as actor, the centre's "self" rule skipped the admin's own
    -- copy); who sent it is in the change history below
    IF public.notification_centre_emit('admin_announcement', _r, NULL, NULL, _title, _message,
                                       'admin_announcement:' || _batch || ':' || _r::text) IS NOT NULL THEN
      _sent := _sent + 1;
    END IF;
  END LOOP;

  INSERT INTO public.notification_centre_changes (changed_by, subject, field, old_value, new_value)
  VALUES (_uid, 'admin_announcement', 'sent', NULL,
          jsonb_build_object('title', _title, 'who', _who, 'asked', _total, 'sent', _sent));

  RETURN jsonb_build_object('sent', _sent, 'asked', _total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_notif_announce(text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_notif_announce(text, text, text, uuid[]) TO authenticated;   -- admin check inside

COMMIT;
