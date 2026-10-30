-- ═══════════════════════════════════════════════════════════════════════════
-- 20261102_0200 · FIRST-POST NUDGE — reminders (idea 3) + the Health number
-- (idea 7). Everything behind ONE switch: site_settings `first_post_nudge`.
--
-- Owner, 2026-10-30: ~60 % of new members never post. Approved: a "Share your
-- first photo" step (client), a true promise on it (client), reminders at 1,
-- 3 and 7 days, and "New members who posted within 7 days" in Admin → Health.
--
-- THE SWITCH. site_settings key `first_post_nudge`, value "on" (jsonb string)
-- = on; no row or anything else = off = today's behaviour. THIS FILE INSERTS
-- NO ROW: it ships OFF on every lane. Switching on is the Owner's call.
-- public.first_post_nudge_on() is the one server-side reading of it.
--
-- WHAT IT ADDS
--   table    public.first_post_reminders   (user_id, day) → due_at, status
--            queued | sent | cancelled. Server-only: RLS on, no policy, no
--            grant to anon/authenticated.
--   trigger  trg_first_post_reminders_queue  AFTER INSERT ON public.profiles
--            — a new member (profiles row = sign-up, handle_new_user) gets
--            three rows due at sign-up + 1, 3, 7 days, ONLY while the switch
--            is on. Never fails a sign-up (errors are logged, row returned).
--   trigger  trg_first_post_reminders_cancel AFTER INSERT ON public.posts
--            — the first post cancels that member's queued rows, forever.
--            Runs whatever the switch says (cancelling is always safe).
--   function public.first_post_reminders_tick()  pg_cron, hourly at :17.
--            Switch off → does nothing at all. On → for each queued row that
--            is due: posted already → cancelled; more than a day late (e.g.
--            the switch was off on the day) → cancelled, never a late burst;
--            otherwise ONE bell row (type first_post_reminder, dedup_key per
--            member+day, email_sent = true) — the existing push trigger
--            (push_on_notification → send-push) delivers it and respects the
--            member's push opt-out (push_enabled); plus ONE e-mail through the
--            existing queue (enqueue_email → process-email-queue), the same
--            notification-alert layout send_notification_email() uses, with
--            the button opening the post flow — only if the member has not
--            switched off reminder e-mails (notification_preferences.
--            email_reengagement) and the address is not in suppressed_emails.
--   function public.admin_first_post_rate(_weeks)  admin-only: per sign-up
--            week, members, how many posted within 7 days of signing up, %.
--
-- WHY THE E-MAIL IS ENQUEUED HERE AND NOT LEFT TO THE BELL TRIGGER.
-- send_notification_email() sends any unknown type to /dashboard and decides
-- opt-out through get_notification_email_enabled(), which has no branch for a
-- reminder (ELSE true — it would mail members who switched reminder e-mails
-- off). Rewriting either live body to add a branch risks drift (F-P7-1); the
-- bell row is inserted with email_sent = true, which that trigger's first line
-- honours, and the e-mail is built here with the right link and the right
-- opt-out. No edge function is added or changed: nothing to deploy.
--
-- Rollback: supabase/rollback/20261102_0200_first_post_nudge_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261102_0200_first_post_nudge.sql
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
  -- PRE-001 · not applied before
  IF to_regclass('public.first_post_reminders') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname IN ('first_post_nudge_on', 'first_post_reminders_tick',
                                 'admin_first_post_rate', 'tg_first_post_reminders_queue',
                                 'tg_first_post_reminders_cancel')) THEN
    RAISE EXCEPTION 'FPN-0200-PRE-001: already applied (table or a function exists) — roll back first';
  END IF;
  -- PRE-002 · everything this file reads, with the columns it reads
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND
        ((table_name = 'site_settings'      AND column_name IN ('key', 'value')) OR
         (table_name = 'profiles'           AND column_name IN ('id', 'full_name', 'is_suspended')) OR
         (table_name = 'posts'              AND column_name IN ('id', 'user_id', 'created_at')) OR
         (table_name = 'user_notifications' AND column_name IN ('user_id', 'type', 'title', 'message', 'dedup_key', 'email_sent')) OR
         (table_name = 'notification_preferences' AND column_name IN ('user_id', 'email_reengagement')) OR
         (table_name = 'suppressed_emails'  AND column_name = 'email') OR
         (table_name = 'email_unsubscribe_tokens' AND column_name IN ('token', 'email', 'used_at')) OR
         (table_name = 'email_send_log'     AND column_name IN ('message_id', 'template_name', 'recipient_email', 'status'))
        )) <> 24 THEN
    RAISE EXCEPTION 'FPN-0200-PRE-002: a table/column this file reads is missing on this lane — refusing';
  END IF;
  -- PRE-003 · the e-mail queue writer, the admin check, pg_cron
  IF to_regprocedure('public.enqueue_email(text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FPN-0200-PRE-003: public.enqueue_email(text, jsonb) missing';
  END IF;
  IF to_regprocedure('public.has_role(uuid, public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'FPN-0200-PRE-003: public.has_role(uuid, app_role) missing';
  END IF;
  IF to_regprocedure('cron.schedule(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'FPN-0200-PRE-003: pg_cron (cron.schedule) not installed';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'first-post-reminders') THEN
    RAISE EXCEPTION 'FPN-0200-PRE-003: cron job first-post-reminders already exists';
  END IF;
  -- PRE-004 · the unique dedup index the bell insert relies on
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'user_notifications'
                  AND indexdef ILIKE '%UNIQUE%(dedup_key)%') THEN
    RAISE EXCEPTION 'FPN-0200-PRE-004: no UNIQUE index on user_notifications(dedup_key)';
  END IF;
END
$pre$;

-- ── the switch ────────────────────────────────────────────────────────────
CREATE FUNCTION public.first_post_nudge_on()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.site_settings s
                  WHERE s.key = 'first_post_nudge' AND s.value = to_jsonb('on'::text));
$fn$;
COMMENT ON FUNCTION public.first_post_nudge_on() IS
  'FIRST-POST NUDGE (20261102_0200): true only when site_settings first_post_nudge = "on". No row = off.';
REVOKE ALL ON FUNCTION public.first_post_nudge_on() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_post_nudge_on() TO service_role;

-- ── the queue ─────────────────────────────────────────────────────────────
CREATE TABLE public.first_post_reminders (
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  day           smallint    NOT NULL CHECK (day IN (1, 3, 7)),
  due_at        timestamptz NOT NULL,
  status        text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'cancelled')),
  queued_at     timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz,
  cancel_reason text        CHECK (cancel_reason IN ('posted', 'late', 'no_profile', 'suspended')),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX idx_first_post_reminders_due ON public.first_post_reminders (due_at) WHERE status = 'queued';
COMMENT ON TABLE public.first_post_reminders IS
  'FIRST-POST NUDGE (20261102_0200): reminders at sign-up + 1/3/7 days. Queued at sign-up while first_post_nudge is on; cancelled by the first post; sent by first_post_reminders_tick(). Server-only.';
ALTER TABLE public.first_post_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_post_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.first_post_reminders TO service_role;

-- ── queue at sign-up ──────────────────────────────────────────────────────
CREATE FUNCTION public.tg_first_post_reminders_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _signed_up timestamptz;
BEGIN
  IF NOT public.first_post_nudge_on() THEN
    RETURN NEW;
  END IF;
  SELECT u.created_at INTO _signed_up FROM auth.users u WHERE u.id = NEW.id;
  _signed_up := coalesce(_signed_up, now());
  INSERT INTO public.first_post_reminders (user_id, day, due_at)
  SELECT NEW.id, d, _signed_up + make_interval(days => d)
    FROM unnest(ARRAY[1, 3, 7]::smallint[]) AS d
  ON CONFLICT (user_id, day) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A reminder is never worth a failed sign-up.
  RAISE LOG 'tg_first_post_reminders_queue: % / %', SQLSTATE, SQLERRM;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.tg_first_post_reminders_queue() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_first_post_reminders_queue
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_first_post_reminders_queue();

-- ── the first post cancels, forever ───────────────────────────────────────
CREATE FUNCTION public.tg_first_post_reminders_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Almost every post is by a member with nothing queued: a plain index read,
  -- no write and no subtransaction. Only a member's FIRST post pays for one.
  IF NOT EXISTS (SELECT 1 FROM public.first_post_reminders q
                  WHERE q.user_id = NEW.user_id AND q.status = 'queued') THEN
    RETURN NEW;
  END IF;
  BEGIN
    UPDATE public.first_post_reminders
       SET status = 'cancelled', done_at = now(), cancel_reason = 'posted'
     WHERE user_id = NEW.user_id AND status = 'queued';
  EXCEPTION WHEN OTHERS THEN
    -- A reminder is never worth a failed post; the tick re-checks posts anyway.
    RAISE LOG 'tg_first_post_reminders_cancel: % / %', SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.tg_first_post_reminders_cancel() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_first_post_reminders_cancel
  AFTER INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_first_post_reminders_cancel();

-- ── the sender ────────────────────────────────────────────────────────────
CREATE FUNCTION public.first_post_reminders_tick()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _site   constant text := 'https://www.50mmretina.com';
  _url    constant text := 'https://www.50mmretina.com/feed?compose=1';
  r       record;
  _sent   integer := 0;
  _title  text;
  _msg    text;
  _email  text;
  _name   text;
  _token  text;
  _mid    text;
  _html   text;
  _text   text;
  _susp   boolean;
BEGIN
  -- Off = today's behaviour: nothing is sent, nothing is touched.
  IF NOT public.first_post_nudge_on() THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT q.user_id, q.day, q.due_at
      FROM public.first_post_reminders q
     WHERE q.status = 'queued' AND q.due_at <= now()
     ORDER BY q.due_at
     LIMIT 500
       FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM public.posts p WHERE p.user_id = r.user_id) THEN
      UPDATE public.first_post_reminders SET status = 'cancelled', done_at = now(), cancel_reason = 'posted'
       WHERE user_id = r.user_id AND status = 'queued';
      CONTINUE;
    END IF;
    IF r.due_at < now() - interval '1 day' THEN
      UPDATE public.first_post_reminders SET status = 'cancelled', done_at = now(), cancel_reason = 'late'
       WHERE user_id = r.user_id AND day = r.day;
      CONTINUE;
    END IF;
    SELECT coalesce(nullif(btrim(pr.full_name), ''), 'there'), coalesce(pr.is_suspended, false)
      INTO _name, _susp FROM public.profiles pr WHERE pr.id = r.user_id;
    IF NOT FOUND THEN
      UPDATE public.first_post_reminders SET status = 'cancelled', done_at = now(), cancel_reason = 'no_profile'
       WHERE user_id = r.user_id AND day = r.day;
      CONTINUE;
    END IF;
    IF _susp THEN
      UPDATE public.first_post_reminders SET status = 'cancelled', done_at = now(), cancel_reason = 'suspended'
       WHERE user_id = r.user_id AND day = r.day;
      CONTINUE;
    END IF;

    -- One member's failure (a bad address, a queue error) must not roll back
    -- the whole hour: each send is its own subtransaction; on error the row
    -- stays queued for the next tick and the reason goes to the log.
    BEGIN

    _title := 'Share your first photo';
    _msg := CASE r.day
              WHEN 1 THEN 'Feeds keep a share of places for new photographers. Your first photo is waiting to join them. Tap to post it.'
              WHEN 3 THEN 'Photographers here are waiting to see your first photo. Tap to post it.'
              ELSE        'Last reminder: share your first photo with the community. Tap to post it.'
            END;

    -- Bell + push. The push trigger reads push_enabled; email_sent = true keeps
    -- send_notification_email() out of it (the e-mail is built below).
    INSERT INTO public.user_notifications (user_id, type, title, message, dedup_key, email_sent)
    VALUES (r.user_id, 'first_post_reminder', _title, _msg,
            'first_post_reminder:' || r.user_id::text || ':' || r.day::text, true)
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

    -- E-mail: reminder e-mails not switched off, address not suppressed.
    SELECT u.email INTO _email FROM auth.users u WHERE u.id = r.user_id;
    IF _email IS NOT NULL
       AND coalesce((SELECT np.email_reengagement FROM public.notification_preferences np WHERE np.user_id = r.user_id), true)
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE s.email = lower(_email)) THEN
      SELECT t.token INTO _token FROM public.email_unsubscribe_tokens t
       WHERE t.email = lower(_email) AND t.used_at IS NULL LIMIT 1;
      IF _token IS NULL THEN
        _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES (_token, lower(_email))
        ON CONFLICT (email) DO NOTHING;
        SELECT t.token INTO _token FROM public.email_unsubscribe_tokens t
         WHERE t.email = lower(_email) AND t.used_at IS NULL LIMIT 1;
      END IF;
      _mid := gen_random_uuid()::text;
      -- The notification-alert layout (send_notification_email), button → post flow.
      _html := '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"/></head><body style="background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;"><div style="padding:32px 24px;max-width:480px;margin:0 auto;"><h1 style="font-size:20px;font-weight:700;color:#1c2d41;margin:0 0 8px;">Hi '
            || replace(replace(replace(_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
            || ',</h1><p style="font-size:11px;font-weight:600;color:#0284c7;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">'
            || _title || '</p><p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px;">' || _msg
            || '</p><a href="' || _url || '" style="display:inline-block;background-color:#0284c7;color:#f0f9ff;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Share a photo</a><hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;"/><p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">You are receiving this because you joined '
            || '50mm Retina World. You can switch these reminders off in Settings → Notifications → "We Miss You Emails".</p></div></body></html>';
      _text := 'Hi ' || _name || ',' || E'\n\n' || _title || E'\n\n' || _msg || E'\n\n' || 'Share a photo: ' || _url
            || E'\n\n---\nYou are receiving this because you joined 50mm Retina World. You can switch these reminders off in Settings → Notifications → "We Miss You Emails".';
      INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status)
      VALUES (_mid, 'notification-alert', _email, 'pending');
      PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
        'message_id', _mid, 'to', _email,
        'from', '50mm Retina World <noreply@www.50mmretina.com>',
        'sender_domain', 'notify.www.50mmretina.com',
        'subject', _title || E' — 50mm Retina World', 'html', _html, 'text', _text,
        'purpose', 'transactional', 'label', 'notification-alert',
        'idempotency_key', 'first-post-' || r.user_id::text || '-' || r.day::text,
        'unsubscribe_token', _token,
        'queued_at', now()::text
      ));
    END IF;

    UPDATE public.first_post_reminders SET status = 'sent', done_at = now()
     WHERE user_id = r.user_id AND day = r.day;
    _sent := _sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'first_post_reminders_tick: day % not sent this hour: % / %', r.day, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RETURN _sent;
END
$fn$;
COMMENT ON FUNCTION public.first_post_reminders_tick() IS
  'FIRST-POST NUDGE (20261102_0200): sends due first-post reminders (bell+push via user_notifications, e-mail via enqueue_email). Switch off = no-op. pg_cron first-post-reminders, hourly at :17. service_role only.';
REVOKE ALL ON FUNCTION public.first_post_reminders_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_post_reminders_tick() TO service_role;

SELECT cron.schedule('first-post-reminders', '17 * * * *', $cron$SELECT public.first_post_reminders_tick();$cron$);

-- ── Admin → Health ────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_first_post_rate(_weeks integer DEFAULT 8)
RETURNS TABLE (week_start date, members integer, posted_within_7d integer, pct numeric, complete boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _n   integer := LEAST(GREATEST(coalesce(_weeks, 8), 1), 26);
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH weeks AS (
    SELECT (date_trunc('week', now() AT TIME ZONE 'UTC') - make_interval(weeks => g))::date AS w
      FROM generate_series(0, _n - 1) g
  ),
  m AS (
    SELECT (date_trunc('week', u.created_at AT TIME ZONE 'UTC'))::date AS w,
           EXISTS (SELECT 1 FROM public.posts p
                    WHERE p.user_id = u.id AND p.created_at < u.created_at + interval '7 days') AS posted
      FROM auth.users u
      JOIN public.profiles pr ON pr.id = u.id
     WHERE u.created_at >= (SELECT min(w) FROM weeks)::timestamp AT TIME ZONE 'UTC'
  )
  SELECT wk.w,
         count(m.w)::integer,
         count(m.w) FILTER (WHERE m.posted)::integer,
         CASE WHEN count(m.w) = 0 THEN NULL
              ELSE round(100.0 * count(m.w) FILTER (WHERE m.posted) / count(m.w), 1) END,
         -- every member of the week has had their full 7 days
         ((wk.w + 14)::timestamp AT TIME ZONE 'UTC') <= now()
    FROM weeks wk
    LEFT JOIN m ON m.w = wk.w
   GROUP BY wk.w
   ORDER BY wk.w DESC;
END
$fn$;
COMMENT ON FUNCTION public.admin_first_post_rate(integer) IS
  'FIRST-POST NUDGE (20261102_0200): Admin → Health. Per UTC sign-up week (Monday), the last _weeks weeks: members, members whose first post came within 7 days of sign-up, %, and whether the week''s 7-day windows have all closed. Admin only.';
REVOKE ALL ON FUNCTION public.admin_first_post_rate(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_first_post_rate(integer) TO authenticated, service_role;

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
        AND proconfig = ARRAY['search_path=""']
        AND proname IN ('first_post_nudge_on', 'first_post_reminders_tick', 'admin_first_post_rate',
                        'tg_first_post_reminders_queue', 'tg_first_post_reminders_cancel')) <> 5 THEN
    RAISE EXCEPTION 'FPN-0200-POST-001: not every function is SECURITY DEFINER with search_path=""';
  END IF;
  IF has_function_privilege('anon', 'public.first_post_reminders_tick()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.first_post_reminders_tick()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_first_post_rate(integer)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.first_post_reminders', 'SELECT')
     OR has_table_privilege('anon', 'public.first_post_reminders', 'SELECT') THEN
    RAISE EXCEPTION 'FPN-0200-POST-002: a member role can reach the queue or the tick';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
        AND tgname IN ('trg_first_post_reminders_queue', 'trg_first_post_reminders_cancel')) <> 2 THEN
    RAISE EXCEPTION 'FPN-0200-POST-003: a trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'first-post-reminders' AND schedule = '17 * * * *') THEN
    RAISE EXCEPTION 'FPN-0200-POST-004: cron job missing';
  END IF;
  -- Shipped OFF: this file must not have created the switch row.
  IF EXISTS (SELECT 1 FROM public.site_settings WHERE key = 'first_post_nudge' AND value = to_jsonb('on'::text))
     AND current_setting('p32.lane') = 'production' THEN
    RAISE NOTICE 'FPN-0200-POST-005: first_post_nudge is already "on" on production (set by the Owner, not by this file)';
  END IF;
END
$post$;

COMMIT;
