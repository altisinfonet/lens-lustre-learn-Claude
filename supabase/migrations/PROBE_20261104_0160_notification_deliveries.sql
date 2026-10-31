-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0160 push receipts + failure alarm. READ ONLY, ROLLBACK.
-- PASS = table (RLS on, members cannot read it), the four functions
-- (SECURITY DEFINER, search_path=""), the right callers (start/finish/tick:
-- service_role only; opened: members) and an active 15-minute cron job.
-- FAILS before apply. Prints counts only. (That start() records nothing while
-- a group is off is shown on the fixture — a read-only PROBE cannot call it.)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE f text; n integer;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.notification_deliveries missing (0160 not applied)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_deliveries'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL: RLS is off on notification_deliveries';
  END IF;
  IF has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT')
     OR has_table_privilege('anon', 'public.notification_deliveries', 'SELECT') THEN
    RAISE EXCEPTION 'PROBE FAIL: members can read notification_deliveries';
  END IF;
  FOREACH f IN ARRAY ARRAY['notification_delivery_start(uuid,text,text,uuid)',
                           'notification_delivery_finish(bigint,integer,integer,integer,text)',
                           'notification_delivery_opened(bigint)',
                           'notification_delivery_alarm_tick()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.' || f) AND prosecdef
                    AND proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'PROBE FAIL: % missing or not SECURITY DEFINER / search_path=""', f;
    END IF;
    IF has_function_privilege('anon', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'PROBE FAIL: anon can run %', f;
    END IF;
    IF f <> 'notification_delivery_opened(bigint)' AND has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'PROBE FAIL: members can run %', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.notification_delivery_opened(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: members cannot report an opened push';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-delivery-alarm' AND active
                  AND schedule = '*/15 * * * *' AND command ILIKE '%notification_delivery_alarm_tick()%') THEN
    RAISE EXCEPTION 'PROBE FAIL: 15-minute alarm cron job missing or inactive';
  END IF;
  SELECT count(*) INTO n FROM public.notification_deliveries;
  RAISE NOTICE 'NC0160 PASS (lane %): table, 4 functions, callers and cron in place; % receipt row(s)',
    current_setting('p32.lane'), n;
END
$p$;

ROLLBACK;
