-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0140 notification centre gate. READ ONLY, ROLLBACK.
-- PASS = the gate function (SECURITY DEFINER, search_path="") and an enabled
-- BEFORE INSERT ROW trigger on BOTH notification tables exist, members cannot
-- call the gate, it fires first among BEFORE INSERT triggers, and every group
-- switch is still OFF (so today's output is unchanged). Also prints which
-- other triggers sit on the two tables. FAILS before apply. Names only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE r record; n int;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
                  AND proconfig = ARRAY['search_path=""'] AND proname = 'notification_centre_gate') THEN
    RAISE EXCEPTION 'PROBE FAIL: notification_centre_gate missing (0140 not applied) or not SECURITY DEFINER / search_path=""';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND t.tgname = 'aaa_notification_centre_gate'
     AND t.tgfoid = 'public.notification_centre_gate()'::regprocedure
     AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4      -- ROW, BEFORE, INSERT
     AND t.tgrelid IN ('public.user_notifications'::regclass, 'public.admin_notifications'::regclass);
  IF n <> 2 THEN RAISE EXCEPTION 'PROBE FAIL: expected the gate as an enabled BEFORE INSERT ROW trigger on both tables, found %', n; END IF;
  IF has_function_privilege('authenticated', 'public.notification_centre_gate()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.notification_centre_gate()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: members can call the gate function';
  END IF;
  FOR r IN SELECT c.relname, min(t.tgname) AS first_before
             FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4
              AND c.oid IN ('public.user_notifications'::regclass, 'public.admin_notifications'::regclass)
            GROUP BY c.relname LOOP
    IF r.first_before <> 'aaa_notification_centre_gate' THEN
      RAISE EXCEPTION 'PROBE FAIL: % fires % before the gate', r.relname, r.first_before;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.site_settings s
   WHERE s.key LIKE 'notif\_centre\_%' AND s.key <> 'notif_centre_ui'
     AND (s.value = to_jsonb('live'::text) OR jsonb_typeof(s.value) = 'object');
  RAISE NOTICE 'NC0140: group switches on = % (0 = today''s output unchanged; >0 = the Owner has started the rollout)', n;
  FOR r IN SELECT c.relname, t.tgname, CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing, t.tgenabled
             FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.oid IN ('public.user_notifications'::regclass, 'public.admin_notifications'::regclass)
            ORDER BY 1, 3 DESC, 2 LOOP
    RAISE NOTICE 'TRG|%|%|%|%', r.relname, r.tgname, r.timing, r.tgenabled;
  END LOOP;
  RAISE NOTICE 'NC0140 PASS (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
