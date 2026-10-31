-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0210 push picture. READ ONLY, ROLLBACK.
-- PASS = push_on_notification() is exactly the 0210 body (md5 cc27b8bc…),
-- still SECURITY DEFINER with search_path=public and still the enabled AFTER
-- INSERT trigger on user_notifications. FAILS before apply. Prints md5 and
-- length only, never source.
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
  IF h <> 'cc27b8bc1dfbef3cede5ad47d5334e5a' THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() is not the 0210 body (md5 %, length %)', h, length(src);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.push_on_notification()') AND prosecdef
                  AND proconfig = ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() lost SECURITY DEFINER / search_path=public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.user_notifications'::regclass AND NOT t.tgisinternal
                  AND t.tgfoid = to_regprocedure('public.push_on_notification()') AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() is not an enabled trigger on user_notifications';
  END IF;
  RAISE NOTICE 'NC0210 PASS (lane %): pushes of a group switched on carry the post picture; body md5 %, length %',
    current_setting('p32.lane'), h, length(src);
END
$p$;

ROLLBACK;
