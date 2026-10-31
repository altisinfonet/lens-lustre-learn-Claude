-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0111 · notification centre N2 SHADOW. READ ONLY, ROLLBACK.
--
-- The 24-hour shadow, done without switching anything on: for every
-- notification today's makers really wrote in the 24 h after 0110 was
-- applied on this lane, ask the centre what IT would have done
-- (notification_centre_replay → notification_centre_decide), and print, per
-- type: rows today wrote, rows the centre would also send, rows it would
-- skip and why (reason → count), and how many would get push / e-mail.
--
-- Window: [apply, apply + 24 h), apply = the registry seed time
-- (min(notification_types.updated_at), written once by 0110's seed).
-- FAILS (expected) until the window is complete; PASSES once it is, and
-- prints the comparison. "Every difference explained" is then written up in
-- docs/evidence/notifications/N2_SHADOW.md — a PROBE cannot judge a reason.
--
-- Stated limits: member settings, blocks and quiet hours are read as they
-- are NOW, not as they were when each row was written; and a notification
-- today's makers did NOT write (but the centre would) cannot be seen here.
-- Prints type names and counts only — no ids, no text.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  since timestamptz; until timestamptz; r record;
  tot bigint := 0; snd bigint := 0; skp bigint := 0;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.notification_types') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: 0110 not applied on this lane';
  END IF;
  SELECT min(updated_at) INTO since FROM public.notification_types;
  until := since + interval '24 hours';
  IF now() < until THEN
    RAISE EXCEPTION 'SHADOW INCOMPLETE (lane %): window % → %, % elapsed — run again after %',
      current_setting('p32.lane'), since, until, date_trunc('minute', now() - since), until;
  END IF;

  RAISE NOTICE 'SHADOW|lane=%|since=%|until=%', current_setting('p32.lane'), since, until;
  FOR r IN SELECT * FROM public.notification_centre_replay(since, until) LOOP
    RAISE NOTICE 'SHADOW|%|%|today=%|centre_send=%|centre_skip=%|reasons=%|push_would=%|email_would=%',
      r.audience,
      CASE WHEN r.type ~ '^[a-z][a-z0-9_-]{0,39}$' AND NOT r.type ~ '[0-9a-f]{8}' THEN r.type ELSE '<other>' END,
      r.today_rows, r.centre_send, r.centre_skip, r.reasons, r.push_would, r.email_would;
    tot := tot + r.today_rows; snd := snd + r.centre_send; skp := skp + r.centre_skip;
  END LOOP;
  RAISE NOTICE 'SHADOW|TOTAL|today=%|centre_send=%|centre_skip=%|equal=%', tot, snd, skp, (skp = 0);
END
$p$;

ROLLBACK;
