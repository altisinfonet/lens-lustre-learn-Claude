-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0230 one log row per notification. READ ONLY, ROLLBACK.
-- PASS = notification_centre_emit is exactly the 0230 body (md5 863c5412…), still
-- SECURITY DEFINER with search_path="". FAILS before apply. md5 + length only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE src text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = to_regprocedure('public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)');
  IF src IS NULL OR md5(src) <> '863c541252b3885063958f3f9ea506d5' THEN
    RAISE EXCEPTION 'PROBE FAIL: notification_centre_emit is not the 0230 body (md5 %, length %)', md5(src), length(src);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)')
                  AND prosecdef AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'PROBE FAIL: notification_centre_emit lost SECURITY DEFINER / search_path=""';
  END IF;
  RAISE NOTICE 'NC0230 PASS (lane %): emit logs only what it skips; body md5 %, length %',
    current_setting('p32.lane'), md5(src), length(src);
END
$p$;

ROLLBACK;
