-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0180 member quiet hours. READ ONLY, ROLLBACK.
-- PASS = both functions exist (SECURITY DEFINER, search_path=""), members can
-- call them, anon cannot, and with no signed-in caller get() returns nothing.
-- FAILS before apply. Prints counts only.
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
  FOREACH f IN ARRAY ARRAY['notif_quiet_hours_get()', 'notif_quiet_hours_set(time,time,text)'] LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN
      RAISE EXCEPTION 'PROBE FAIL: % missing (0180 not applied)', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.' || f) AND prosecdef
                    AND proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'PROBE FAIL: % not SECURITY DEFINER / search_path=""', f;
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'PROBE FAIL: members cannot call %', f;
    END IF;
    IF has_function_privilege('anon', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'PROBE FAIL: anon can call %', f;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.notif_quiet_hours_get();
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: get() returned % row(s) with no signed-in caller', n;
  END IF;
  RAISE NOTICE 'NC0180 PASS (lane %): member quiet-hours functions in place; % member(s) have quiet hours',
    current_setting('p32.lane'), (SELECT count(*) FROM public.notification_quiet_hours);
END
$p$;

ROLLBACK;
