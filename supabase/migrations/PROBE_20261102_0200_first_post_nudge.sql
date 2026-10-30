-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261102_0200 first-post nudge. READ ONLY, ROLLBACK. Counts only.
-- PASS = every object 0200 creates is present with the intended privileges;
-- before the apply it FAILS at the first missing object (expected).
-- Reports, never fails on: the switch state, the queue by status, and the
-- Health numbers' input size. Switching on is the Owner's call.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE r record; sw text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.first_post_reminders') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.first_post_reminders missing (0200 not applied)';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
        AND proconfig = ARRAY['search_path=""']
        AND proname IN ('first_post_nudge_on', 'first_post_reminders_tick', 'admin_first_post_rate',
                        'tg_first_post_reminders_queue', 'tg_first_post_reminders_cancel')) <> 5 THEN
    RAISE EXCEPTION 'PROBE FAIL: the five 0200 functions are not all present as SECURITY DEFINER, search_path=""';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND ((tgname = 'trg_first_post_reminders_queue'  AND tgrelid = 'public.profiles'::regclass)
          OR (tgname = 'trg_first_post_reminders_cancel' AND tgrelid = 'public.posts'::regclass))) <> 2 THEN
    RAISE EXCEPTION 'PROBE FAIL: queue/cancel trigger missing or disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'first-post-reminders' AND active
                  AND command ILIKE '%first_post_reminders_tick()%') THEN
    RAISE EXCEPTION 'PROBE FAIL: cron job first-post-reminders missing or inactive';
  END IF;
  IF has_table_privilege('anon', 'public.first_post_reminders', 'SELECT')
     OR has_table_privilege('authenticated', 'public.first_post_reminders', 'SELECT')
     OR has_function_privilege('authenticated', 'public.first_post_reminders_tick()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.first_post_reminders_tick()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_first_post_rate(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.first_post_nudge_on()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_first_post_rate(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: privileges are not as 0200 sets them';
  END IF;

  SELECT coalesce((SELECT s.value::text FROM public.site_settings s WHERE s.key = 'first_post_nudge'), '(no row = off)') INTO sw;
  RAISE NOTICE 'first_post_nudge (lane %): % · server reads it as on=%',
    current_setting('p32.lane'), sw, public.first_post_nudge_on();
  SELECT count(*) FILTER (WHERE status = 'queued') AS q, count(*) FILTER (WHERE status = 'sent') AS s,
         count(*) FILTER (WHERE status = 'cancelled' AND cancel_reason = 'posted') AS cp,
         count(*) FILTER (WHERE status = 'cancelled' AND cancel_reason <> 'posted') AS co
    INTO r FROM public.first_post_reminders;
  RAISE NOTICE 'queue: queued=% sent=% cancelled(posted)=% cancelled(other)=%', r.q, r.s, r.cp, r.co;
  -- The onboarding step's promise (FirstPostPrompt) holds only while the
  -- personal feed keeps a fair share. Reported, not failed: the mix is the
  -- Owner's config.
  IF to_regclass('public.feed_score_config') IS NOT NULL THEN
    SELECT coalesce(max(c.value) FILTER (WHERE c.key = 'mix_fair'), 2) AS f,
           coalesce(max(c.value) FILTER (WHERE c.key = 'mix_suggested'), 2) AS s,
           coalesce(max(c.value) FILTER (WHERE c.key = 'mix_circle'), 6) AS c
      INTO r FROM public.feed_score_config c;
    RAISE NOTICE 'personal feed mix circle/suggested/fair = %/%/% · onboarding promise holds: %', r.c, r.s, r.f, (r.f > 0);
  ELSE
    RAISE NOTICE 'feed_score_config ABSENT on this lane · onboarding promise NOT verifiable here';
  END IF;
  RAISE NOTICE 'PROBE PASS: 20261102_0200 present as intended';
END
$p$;

ROLLBACK;
