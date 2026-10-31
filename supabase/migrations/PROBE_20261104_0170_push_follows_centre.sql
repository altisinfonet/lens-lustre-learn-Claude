-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0170 push follows the centre. READ ONLY, ROLLBACK.
-- PASS = push_on_notification() is the 0170 body (reads the gate's logged
-- decision for a live group, keeps today's CASE otherwise), still SECURITY
-- DEFINER with search_path=public, still the AFTER INSERT trigger on
-- user_notifications, members cannot call it, and the lookup index exists.
-- FAILS before apply. Prints md5 + length only, never source.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE src text; h text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = to_regprocedure('public.push_on_notification()');
  IF src IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() missing';
  END IF;
  h := md5(src);
  IF src NOT LIKE '%20261104_0170%' OR src NOT LIKE '%notification_centre_log%' OR src NOT LIKE '%np.push_announcements%' THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() is not the 0170 body (md5 %, length %)', h, length(src);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.push_on_notification()') AND prosecdef
                  AND proconfig = ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() lost SECURITY DEFINER / search_path=public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.user_notifications'::regclass AND NOT t.tgisinternal
                  AND t.tgfoid = to_regprocedure('public.push_on_notification()') AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() is not an enabled trigger on user_notifications';
  END IF;
  IF has_function_privilege('authenticated', 'public.push_on_notification()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_on_notification()', 'EXECUTE') THEN
    RAISE NOTICE 'NOTE: members hold EXECUTE on the trigger function (unchanged by 0170; a trigger function cannot be called directly)';
  END IF;
  IF to_regclass('public.notification_centre_log_notification_idx') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: lookup index notification_centre_log_notification_idx missing';
  END IF;
  RAISE NOTICE 'NC0170 PASS (lane %): push follows the centre for live groups; body md5 %, length %',
    current_setting('p32.lane'), h, length(src);
END
$p$;

ROLLBACK;
