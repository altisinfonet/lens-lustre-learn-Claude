-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0200 · NOTIFICATION CENTRE N4 — the weekly summary e-mail.
--
-- The "weekly digest" setting (notification_preferences.email_weekly_digest)
-- has existed since 2026-04-07 with nothing behind it (N0 gap G2). This sends
-- it: once a week, a short e-mail with the member's last 7 days — new
-- followers, likes, comments and mentions, competition updates — and a button
-- to their notifications. Nothing to report → nothing sent.
--
-- WHO: only members for whom the new notification screens are on
-- (site_settings notif_centre_ui = "on", or listed in {"users":[…]}) — that
-- is where the setting is shown again — with the setting on (default on), a
-- live account, an address, and the address not suppressed. notif_centre_ui
-- is OFF on live, so today this sends nothing.
--
-- HOW: the same building blocks as the live send_notification_email (layout,
-- html_escape, unsubscribe token, email_send_log 'pending' row — the e-mail
-- receipt the worker updates to sent / failed / bounced — and
-- enqueue_email('transactional_emails', …) with the live sender settings).
-- Links point at this lane's own site (ops_alarm_settings.lane). At most one
-- per member per week (notification_weekly_summaries + idempotency key).
-- pg_cron notification-weekly-summary: Mondays, hourly 02:41–08:41 UTC (from
-- 08:11 in India); at most 2000 per run, each member once per week.
--
-- Rollback: supabase/rollback/20261104_0200_notification_weekly_summary_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0200_notification_weekly_summary.sql
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
  IF to_regclass('public.notification_weekly_summaries') IS NOT NULL THEN
    RAISE EXCEPTION 'NC-0200-PRE-001: already applied — roll back first';
  END IF;
  IF to_regprocedure('public.enqueue_email(text, jsonb)') IS NULL
     OR to_regprocedure('public.html_escape(text)') IS NULL
     OR to_regclass('public.email_send_log') IS NULL
     OR to_regclass('public.email_unsubscribe_tokens') IS NULL
     OR to_regclass('public.suppressed_emails') IS NULL
     OR to_regclass('public.notification_preferences') IS NULL
     OR to_regclass('public.ops_alarm_settings') IS NULL THEN
    RAISE EXCEPTION 'NC-0200-PRE-002: an e-mail building block this file uses is missing on this lane';
  END IF;
  IF to_regprocedure('cron.schedule(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'NC-0200-PRE-003: pg_cron (cron.schedule) not installed';
  END IF;
END
$pre$;

CREATE TABLE public.notification_weekly_summaries (
  user_id    uuid        NOT NULL,
  week       date        NOT NULL,
  sent       boolean     NOT NULL,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week)
);
ALTER TABLE public.notification_weekly_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_weekly_summaries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_weekly_summaries TO service_role;

CREATE FUNCTION public.notification_weekly_summary_send()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _week  date := date_trunc('week', now())::date;
  _site  text := CASE (SELECT a.lane FROM public.ops_alarm_settings a WHERE a.id = 1)
                   WHEN 'production' THEN 'https://www.50mmretina.com'
                   ELSE 'https://staging.50mmretina.com' END;
  _ui    jsonb;
  r      record;
  c      record;
  _total integer;
  _lines text;
  _plain text;
  _html  text;
  _token text;
  _mid   text;
  _sent  integer := 0;
BEGIN
  SELECT s.value INTO _ui FROM public.site_settings s WHERE s.key = 'notif_centre_ui';
  IF _ui IS NULL THEN
    RETURN 0;                                         -- new screens off: nothing is sent
  END IF;

  DELETE FROM public.notification_weekly_summaries w WHERE w.week < _week - 84;   -- keep 12 weeks

  FOR r IN
    SELECT p.id AS user_id, coalesce(nullif(p.full_name, ''), 'there') AS name, u.email
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE coalesce(p.is_suspended, false) = false
       AND u.email IS NOT NULL
       AND (_ui = to_jsonb('on'::text)
            OR (jsonb_typeof(_ui) = 'object' AND jsonb_typeof(_ui -> 'users') = 'array' AND (_ui -> 'users') ? p.id::text))
       AND coalesce((SELECT np.email_weekly_digest FROM public.notification_preferences np WHERE np.user_id = p.id), true)
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails x WHERE x.email = lower(u.email))
       AND NOT EXISTS (SELECT 1 FROM public.notification_weekly_summaries w WHERE w.user_id = p.id AND w.week = _week)
     ORDER BY p.id
     LIMIT 2000
  LOOP
    BEGIN
      SELECT count(*) FILTER (WHERE n.type IN ('new_follower', 'friend_request', 'friend_accepted')) AS followers,
             count(*) FILTER (WHERE n.type IN ('post_reaction', 'image_reaction', 'tagged_post_reaction')) AS likes,
             count(*) FILTER (WHERE n.type IN ('post_comment', 'image_comment', 'comment_reply', 'tagged_post_comment',
                                               'ad_comment_reply', 'post_tag')) AS comments,
             count(*) FILTER (WHERE n.type IN (SELECT t.type FROM public.notification_types t WHERE t.group_key = 'competitions')
                                 OR n.type = 'new_competition') AS competitions
        INTO c
        FROM public.user_notifications n
       WHERE n.user_id = r.user_id AND n.created_at > now() - interval '7 days';
      _total := c.followers + c.likes + c.comments + c.competitions;

      IF _total = 0 THEN
        INSERT INTO public.notification_weekly_summaries (user_id, week, sent) VALUES (r.user_id, _week, false);
        CONTINUE;                                     -- nothing to report: no e-mail
      END IF;

      _lines := concat_ws(' · ',
        CASE WHEN c.followers > 0 THEN c.followers || CASE WHEN c.followers = 1 THEN ' new follower' ELSE ' new followers' END END,
        CASE WHEN c.likes > 0 THEN c.likes || CASE WHEN c.likes = 1 THEN ' like' ELSE ' likes' END END,
        CASE WHEN c.comments > 0 THEN c.comments || CASE WHEN c.comments = 1 THEN ' comment or mention' ELSE ' comments and mentions' END END,
        CASE WHEN c.competitions > 0 THEN c.competitions || CASE WHEN c.competitions = 1 THEN ' competition update' ELSE ' competition updates' END END);
      _plain := 'Hi ' || r.name || ',' || E'\n\n' || 'Your week on 50mm Retina World: ' || _lines || '.'
             || E'\n\n' || 'See your notifications: ' || _site || '/notifications'
             || E'\n\n---\nYou get this weekly summary because it is on in Settings → Notifications. You can switch it off there.';
      _html := '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"/></head><body style="background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;"><div style="padding:32px 24px;max-width:480px;margin:0 auto;"><h1 style="font-size:20px;font-weight:700;color:#1c2d41;margin:0 0 8px;">Hi '
            || public.html_escape(r.name)
            || ',</h1><p style="font-size:11px;font-weight:600;color:#0284c7;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">Your week</p><p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px;">'
            || public.html_escape(_lines) || '.</p><a href="' || _site
            || '/notifications" style="display:inline-block;background-color:#0284c7;color:#f0f9ff;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">See your notifications</a><hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;"/><p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">You get this weekly summary because it is on in Settings → Notifications. You can switch it off there.</p></div></body></html>';

      SELECT t.token INTO _token FROM public.email_unsubscribe_tokens t WHERE t.email = lower(r.email) AND t.used_at IS NULL LIMIT 1;
      IF _token IS NULL THEN
        _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES (_token, lower(r.email)) ON CONFLICT (email) DO NOTHING;
        SELECT t.token INTO _token FROM public.email_unsubscribe_tokens t WHERE t.email = lower(r.email) AND t.used_at IS NULL LIMIT 1;
      END IF;

      _mid := gen_random_uuid()::text;
      INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status)
      VALUES (_mid, 'weekly-summary', r.email, 'pending');
      PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
        'message_id', _mid, 'to', r.email,
        'from', '50mm Retina World <no-reply@50mmretina.com>',
        'sender_domain', '50mmretina.com',
        'subject', 'Your week on 50mm Retina World', 'html', _html, 'text', _plain,
        'purpose', 'transactional', 'label', 'weekly-summary',
        'idempotency_key', 'weekly-' || r.user_id::text || '-' || _week::text,
        'unsubscribe_token', _token,
        'queued_at', now()::text));
      INSERT INTO public.notification_weekly_summaries (user_id, week, sent, message_id) VALUES (r.user_id, _week, true, _mid);
      _sent := _sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'notification_weekly_summary_send: member not sent this week: % / %', SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RETURN _sent;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notification_weekly_summary_send() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_weekly_summary_send() TO service_role;

-- Hourly 02:41–08:41 UTC on Mondays: each run sends at most 2000, and the
-- per-week record makes later runs pick up only who is left — so a large
-- member base is covered the same Monday instead of the same 2000 every week.
SELECT cron.schedule('notification-weekly-summary', '41 2-8 * * 1',
                     $cron$SELECT public.notification_weekly_summary_send();$cron$);

COMMIT;
