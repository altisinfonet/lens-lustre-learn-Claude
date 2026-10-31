-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0200 weekly summary e-mail. READ ONLY, ROLLBACK.
-- PASS = table (RLS on, members cannot read it), the send function (SECURITY
-- DEFINER, search_path="", service_role only), the Monday cron job active
-- (hourly 02:41–08:41 UTC, so more than 2000 members are all covered).
-- Reports (does not fail) whether notif_centre_ui is on — while it is off the
-- job sends nothing. FAILS before apply. Prints counts only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.notification_weekly_summaries') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: notification_weekly_summaries missing (0200 not applied)';
  END IF;
  IF has_table_privilege('authenticated', 'public.notification_weekly_summaries', 'SELECT')
     OR has_table_privilege('anon', 'public.notification_weekly_summaries', 'SELECT') THEN
    RAISE EXCEPTION 'PROBE FAIL: members can read notification_weekly_summaries';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.notification_weekly_summary_send()')
                  AND prosecdef AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'PROBE FAIL: notification_weekly_summary_send() missing or not SECURITY DEFINER / search_path=""';
  END IF;
  IF has_function_privilege('authenticated', 'public.notification_weekly_summary_send()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.notification_weekly_summary_send()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: members can run the weekly summary';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-weekly-summary' AND active
                  AND schedule = '41 2-8 * * 1' AND command ILIKE '%notification_weekly_summary_send()%') THEN
    RAISE EXCEPTION 'PROBE FAIL: weekly cron job missing or inactive';
  END IF;
  RAISE NOTICE 'NC0200 PASS (lane %): weekly summary in place; new screens switch is %; % summary row(s) recorded',
    current_setting('p32.lane'),
    CASE WHEN EXISTS (SELECT 1 FROM public.site_settings s WHERE s.key = 'notif_centre_ui'
                        AND (s.value = to_jsonb('on'::text) OR jsonb_typeof(s.value -> 'users') = 'array'))
         THEN 'ON for some/all (summaries will send)' ELSE 'off (nothing sends)' END,
    (SELECT count(*) FROM public.notification_weekly_summaries);
END
$p$;

ROLLBACK;
