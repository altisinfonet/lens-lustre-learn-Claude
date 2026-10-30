-- ═══════════════════════════════════════════════════════════════════════════
-- 20261102_0201 · SWITCH ON the first-post nudge (site_settings first_post_nudge).
--
-- THE OWNER'S SWITCH. Nothing runs this automatically — and the UNAPPLIED_
-- prefix keeps it out of any in-order replay of supabase/migrations/ (a new
-- project or a bootstrap regeneration), so the nudge is never switched on by
-- accident. Applying it turns on,
-- for every NEW member from that moment: the "Share your first photo" step
-- after the welcome form, and reminders at 1, 3 and 7 days after sign-up
-- (stopped forever by the first post). Members who signed up before it was on
-- get no reminders (nothing was queued for them).
--
-- To switch OFF again: supabase/rollback/20261102_0201_first_post_nudge_switch_on_ROLLBACK.sql
-- (deletes the row — no row = off — and stops the reminder job from sending).
--
-- Requires 20261102_0200 on the lane (refuses otherwise). Idempotent: running
-- it while already on changes nothing.
-- PROBE: supabase/migrations/PROBE_20261102_0201_first_post_nudge_switch_on.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted. Dispatch apply-migration.yml.';
  END IF;
  IF to_regprocedure('public.first_post_reminders_tick()') IS NULL THEN
    RAISE EXCEPTION 'FPN-0201-PRE-001: 20261102_0200 is not applied on this lane — apply it first';
  END IF;
END
$lane_guard$;

INSERT INTO public.site_settings (key, value, updated_at)
VALUES ('first_post_nudge', to_jsonb('on'::text), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
WHERE public.site_settings.value IS DISTINCT FROM EXCLUDED.value;

DO $post$
BEGIN
  IF NOT public.first_post_nudge_on() THEN
    RAISE EXCEPTION 'FPN-0201-POST-001: the switch does not read as on';
  END IF;
  RAISE NOTICE 'first_post_nudge is ON (lane %)', current_setting('p32.lane');
END
$post$;

COMMIT;
