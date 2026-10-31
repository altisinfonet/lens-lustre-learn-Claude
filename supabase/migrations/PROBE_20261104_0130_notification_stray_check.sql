-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0130 nightly stray-writer count. READ ONLY, ROLLBACK.
-- PASS = allow-list table, check function (SECURITY DEFINER, search_path="")
-- and an active nightly cron job exist; members cannot read or run any of it;
-- and RIGHT NOW no live public function outside the allow-list inserts into a
-- notification table (the same scan the nightly job runs, without opening an
-- alarm — this transaction is read-only). FAILS before apply. Prints names
-- and counts only (function names are schema metadata).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE strays text[]; stale text[];
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.notification_writer_allowlist') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.notification_writer_allowlist missing (0130 not applied)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
                  AND proconfig = ARRAY['search_path=""'] AND proname = 'notification_stray_writer_check') THEN
    RAISE EXCEPTION 'PROBE FAIL: notification_stray_writer_check missing or not SECURITY DEFINER / search_path=""';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-stray-writer-check' AND active
                  AND command ILIKE '%notification_stray_writer_check()%') THEN
    RAISE EXCEPTION 'PROBE FAIL: nightly cron job missing or inactive';
  END IF;
  IF has_function_privilege('authenticated', 'public.notification_stray_writer_check()', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.notification_writer_allowlist', 'SELECT') THEN
    RAISE EXCEPTION 'PROBE FAIL: members can run the check or read the allow-list';
  END IF;

  SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO strays
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
     AND (CASE WHEN p.prosqlbody IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE p.prosrc END)
         ~* 'insert\s+into\s+("?public"?\s*\.\s*)?"?(user_notifications|admin_notifications)\M'
     AND NOT EXISTS (SELECT 1 FROM public.notification_writer_allowlist a WHERE a.fn_name = p.proname);
  SELECT coalesce(array_agg(a.fn_name ORDER BY a.fn_name), '{}') INTO stale
    FROM public.notification_writer_allowlist a
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = a.fn_name);
  RAISE NOTICE 'NC0130 (lane %): allow-list % rows; stray writers now: % %; allow-listed but absent on this lane: % %',
    current_setting('p32.lane'), (SELECT count(*) FROM public.notification_writer_allowlist),
    cardinality(strays), strays, cardinality(stale), stale;
  IF cardinality(strays) > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: % live function(s) write notifications outside the allow-list: %', cardinality(strays), strays;
  END IF;
  RAISE NOTICE 'NC0130 PASS';
END
$p$;

ROLLBACK;
