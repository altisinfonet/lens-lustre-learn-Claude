-- ============================================================================
-- BIRTHDAY NOTIFICATION — "🎉 Today is Neil Basu's Birthday"
--
-- Owner request, 2026-08-04: build the in-app notification, in that exact
-- wording. Decisions taken with him the same day:
--   * recipients  : accepted FRIENDS only (the Facebook behaviour)
--   * delivery    : bell + phone push
--   * email       : none — he did not ask for one
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW THE WORDING REACHES BOTH SURFACES WITH NO EXTRA CODE
--
--   push : notif_push_body(_type, _actor_id, _message) returns `_message`
--          verbatim whenever notif_action_phrase(_type) IS NULL — and it is
--          NULL for 'birthday', because that catalogue only knows the
--          "<name> <verb>" shapes and this sentence is possessive.
--   bell : describeNotification() falls back to the row's `message` for any
--          type it does not phrase, for exactly the same reason.
--
-- So the sentence is written ONCE, here, and both surfaces render it
-- identically. That is the property NOTIFICATIONS_SYSTEM.md calls "one text
-- layer" — this type gets it by construction rather than by two copies.
--
-- The name comes from notif_display_name(), which is the function that already
-- enforces the owner's naming rules (full name first, @username as fallback, an
-- admin always shown as the brand). Hand-writing `full_name` here would have
-- been the fourth place those rules could drift.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `email_sent = true` ON INSERT — READ BEFORE CHANGING IT
--
-- `trg_send_notification_email` fires on every insert into user_notifications
-- and asks get_notification_email_enabled(user_id, type). **That function ends
-- in `ELSE true`** — an unlisted type emails everyone. Verified 2026-08-04.
-- So a birthday row would have sent an email to every friend of every member
-- with a birthday, forever, without anyone asking for it.
--
-- The trigger's very first line is `IF NEW.email_sent IS TRUE THEN RETURN NEW;`
-- so inserting with the flag already set suppresses the email without editing
-- a shared function that 20+ other notification types depend on. This is the
-- smallest change that cannot break anything else.
--
-- PUSH, by contrast, is wanted. `push_on_notification` also ends in `ELSE true`
-- and therefore already pushes this type — but relying on a fall-through is
-- exactly the "implicit behaviour" the owner's standing rules forbid, so the
-- companion statement below states it outright.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY IT CANNOT DOUBLE-SEND
--
-- `uniq_user_notifications_dedup_key` is a UNIQUE partial index on dedup_key.
-- The key is 'birthday:<celebrant>:<YYYY-MM-DD>:<recipient>', so running the
-- job twice on the same day — a retry, a manual run, a cron overlap — inserts
-- nothing the second time. The ON CONFLICT clause repeats the index predicate
-- because inference against a partial index requires it.
--
-- SCHEDULE: 03:30 UTC = 09:00 IST. Same calendar date in both zones at that
-- moment, so it agrees with the sidebar (which is UTC-dated) and still lands in
-- the morning for an India-centred community.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.emit_birthday_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _inserted integer;
BEGIN
  WITH celebrants AS (
    SELECT
      p.id,
      public.notif_display_name(p.id) AS display_name
    FROM public.profiles p
    WHERE p.is_suspended = false
      AND p.date_of_birth IS NOT NULL
      AND to_char(p.date_of_birth, 'MM-DD') = to_char(now(), 'MM-DD')
      -- A member who set their birthday to "only me" is not announced to
      -- anyone. 'friends' needs no test here: every recipient IS a friend.
      AND COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') <> 'only_me'
  ),
  recipients AS (
    SELECT
      c.id                                                                   AS actor_id,
      c.display_name,
      CASE WHEN f.requester_id = c.id THEN f.addressee_id ELSE f.requester_id END AS user_id
    FROM celebrants c
    JOIN public.friendships f
      ON f.status = 'accepted'
     AND (f.requester_id = c.id OR f.addressee_id = c.id)
  )
  INSERT INTO public.user_notifications
    (user_id, type, title, message, reference_id, actor_id, dedup_key, email_sent)
  SELECT
    r.user_id,
    'birthday',
    'Birthday',
    '🎉 Today is ' || r.display_name || '''s Birthday',
    r.actor_id,           -- reference_id: the celebrant, so tapping opens them
    r.actor_id,
    'birthday:' || r.actor_id::text || ':' || to_char(now(), 'YYYY-MM-DD') || ':' || r.user_id::text,
    true                  -- suppress the email; see the header
  FROM recipients r
  JOIN public.profiles rp ON rp.id = r.user_id AND rp.is_suspended = false
  WHERE r.user_id <> r.actor_id
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$$;

COMMENT ON FUNCTION public.emit_birthday_notifications() IS
  'Inserts one in-app + push notification per accepted friend of every member whose birthday is today. Idempotent per day via dedup_key. Skips members who set dob_day_month = only_me. email_sent = true on purpose — see the migration header.';

REVOKE ALL ON FUNCTION public.emit_birthday_notifications() FROM PUBLIC, anon, authenticated;

-- Daily at 03:30 UTC (09:00 IST).
SELECT cron.unschedule('emit-birthday-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emit-birthday-notifications');

SELECT cron.schedule(
  'emit-birthday-notifications',
  '30 3 * * *',
  $cron$SELECT public.emit_birthday_notifications();$cron$
);
