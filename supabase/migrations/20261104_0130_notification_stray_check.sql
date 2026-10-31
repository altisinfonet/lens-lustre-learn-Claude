-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0130 · NOTIFICATION CENTRE N5 (part 2) — the nightly live
-- stray-writer count. The CI ratchet (scripts/notif-guard-check.mjs) sees git;
-- this sees the LIVE database, where a function can be created without git.
--
-- WHAT IT ADDS
--   table    public.notification_writer_allowlist (fn_name, reason) — every
--            public function allowed to INSERT into user_notifications /
--            admin_notifications. Seeded with the CI ratchet's SQL entries
--            (scripts/notif-guard-allow.json as N1 / #766 leaves it, 2026-10-31:
--            28 makers + pj_handle_tag_notification + the centre's two write
--            functions = 31; the three notify_post_* functions are left OUT on
--            purpose — their live bodies only queue, so if one ever writes the
--            tables directly the alarm fires). N3 deletes rows as makers move.
--
-- KNOWN LIMITS (accepted): dynamic SQL (EXECUTE format('INSERT INTO %I'))
-- and writers outside schema public are not seen; the list matches by name,
-- so a new overload of a listed name is not flagged; a comment mentioning an
-- insert counts as a stray (false alarm, the safe direction).
--   function public.notification_stray_writer_check()  READ-ONLY scan of
--            pg_proc: live public functions whose source inserts into either
--            table and are not allow-listed. Opens (or closes) the ops alarm
--            `notif_stray_writer` via ops_alarm_set — the existing alarm relay
--            delivers it. Returns the stray count.
--   cron     notification-stray-writer-check, nightly 03:23 UTC.
--
-- Rollback: supabase/rollback/20261104_0130_notification_stray_check_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0130_notification_stray_check.sql
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
  IF to_regclass('public.notification_writer_allowlist') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname = 'notification_stray_writer_check') THEN
    RAISE EXCEPTION 'NC-0130-PRE-001: already applied — roll back first';
  END IF;
  IF to_regprocedure('public.ops_alarm_set(text, boolean, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'NC-0130-PRE-002: public.ops_alarm_set missing (20261103_0300 not applied)';
  END IF;
  IF to_regprocedure('cron.schedule(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'NC-0130-PRE-003: pg_cron (cron.schedule) not installed';
  END IF;
END
$pre$;

CREATE TABLE public.notification_writer_allowlist (
  fn_name  text PRIMARY KEY CHECK (fn_name ~ '^[a-z_][a-z0-9_]*$'),
  reason   text NOT NULL CHECK (length(reason) >= 10),
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_writer_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_writer_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.notification_writer_allowlist TO service_role;

INSERT INTO public.notification_writer_allowlist (fn_name, reason)
SELECT n, 'existed 2026-10-31 (CI ratchet scripts/notif-guard-allow.json); moves onto the centre in N3'
  FROM unnest(ARRAY[
    'emit_birthday_notifications','emit_notification','fan_out_new_post','first_post_reminders_tick',
    'notify_ad_comment_reply','notify_admin_comment_report','notify_admin_new_ticket','notify_admin_post_report',
    'notify_admin_role_application','notify_admin_user_blocked','notify_badge_awarded','notify_certificate_issued',
    'notify_competition_vote','notify_course_published','notify_featured_artist','notify_friend_request_accepted',
    'notify_friend_request_received','notify_image_comment','notify_image_reaction','notify_journal_published',
    'notify_new_competition','notify_new_follower','notify_potd_featured','notify_role_application_decision','notify_user_ticket_reply',
    'pj_handle_comment_notification','pj_handle_reaction_notification','video_takedown']) n
UNION ALL
SELECT n, 'the notification centre''s own write path (N2 / N6)'
  FROM unnest(ARRAY['notification_centre_emit', 'notification_centre_send_test']) n
UNION ALL
SELECT 'pj_handle_tag_notification', 'existed live 2026-10-31 (captured into git by N1, 20261104_0150); moves in N3 group 1';

CREATE FUNCTION public.notification_stray_writer_check()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  strays text[];
BEGIN
  SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO strays
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind IN ('f', 'p')
     AND (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END)
         ~* 'insert\s+into\s+("?public"?\s*\.\s*)?"?(user_notifications|admin_notifications)\M'
     AND NOT EXISTS (SELECT 1 FROM public.notification_writer_allowlist a WHERE a.fn_name = p.proname);

  PERFORM public.ops_alarm_set(
    'notif_stray_writer',
    cardinality(strays) > 0,
    format('%s live function(s) write notifications outside the notification centre', cardinality(strays)),
    jsonb_build_object('functions', to_jsonb(strays), 'checked_at', now()));
  RETURN cardinality(strays);
END;
$fn$;

REVOKE ALL ON FUNCTION public.notification_stray_writer_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_stray_writer_check() TO service_role;

-- POST: the live database must be clean against this list at apply time, so
-- the first nightly run does not open an alarm for something already known.
-- A stray found here aborts the whole apply and names it (schema metadata).
DO $post$
DECLARE strays text[];
BEGIN
  SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO strays
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind IN ('f', 'p')
     AND (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END)
         ~* 'insert\s+into\s+("?public"?\s*\.\s*)?"?(user_notifications|admin_notifications)\M'
     AND NOT EXISTS (SELECT 1 FROM public.notification_writer_allowlist a WHERE a.fn_name = p.proname);
  IF cardinality(strays) > 0 THEN
    RAISE EXCEPTION 'NC-0130-POST-001: % live function(s) write notifications and are not on the list: % — decide each one before applying', cardinality(strays), strays;
  END IF;
END
$post$;

SELECT cron.schedule('notification-stray-writer-check', '23 3 * * *',
                     $cron$SELECT public.notification_stray_writer_check();$cron$);

COMMIT;
