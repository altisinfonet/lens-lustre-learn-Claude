-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261102_0201 — SWITCH OFF the first-post nudge.
-- Deletes the site_settings row (no row = off = today's behaviour). From the
-- next hour the reminder job sends nothing; reminders already queued stay
-- queued and are cancelled as late if the switch stays off past their day.
-- Idempotent: running it while already off changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

DELETE FROM public.site_settings WHERE key = 'first_post_nudge';

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM public.site_settings WHERE key = 'first_post_nudge') THEN
    RAISE EXCEPTION 'FPN-0201-RB-POST-001: the switch row is still present';
  END IF;
  RAISE NOTICE 'first_post_nudge is OFF (lane %)', current_setting('p32.lane');
END
$post$;

COMMIT;
