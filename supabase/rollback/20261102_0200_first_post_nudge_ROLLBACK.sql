-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261102_0200 first-post nudge.
-- Removes exactly what 20261102_0200 created: the cron job, the two triggers,
-- the five functions and the queue table (its rows go with it — they are
-- reminders, not member data). It does NOT touch site_settings: the switch row
-- belongs to the Owner. Bell rows already sent (type first_post_reminder) stay
-- in user_notifications — they are what the member received.
-- Refuses when 0200 is not applied, so a second run fails loudly.
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
  IF to_regclass('public.first_post_reminders') IS NULL THEN
    RAISE EXCEPTION 'FPN-0200-RB-PRE-001: 20261102_0200 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'first-post-reminders';

DROP TRIGGER IF EXISTS trg_first_post_reminders_queue  ON public.profiles;
DROP TRIGGER IF EXISTS trg_first_post_reminders_cancel ON public.posts;
DROP FUNCTION IF EXISTS public.tg_first_post_reminders_queue();
DROP FUNCTION IF EXISTS public.tg_first_post_reminders_cancel();
DROP FUNCTION IF EXISTS public.first_post_reminders_tick();
DROP FUNCTION IF EXISTS public.admin_first_post_rate(integer);
DROP FUNCTION IF EXISTS public.first_post_nudge_on();
DROP TABLE IF EXISTS public.first_post_reminders;

DO $post$
BEGIN
  IF to_regclass('public.first_post_reminders') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname IN ('first_post_nudge_on', 'first_post_reminders_tick', 'admin_first_post_rate',
                                 'tg_first_post_reminders_queue', 'tg_first_post_reminders_cancel'))
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'first-post-reminders') THEN
    RAISE EXCEPTION 'FPN-0200-RB-POST-001: something 20261102_0200 created is still present';
  END IF;
END
$post$;

COMMIT;
