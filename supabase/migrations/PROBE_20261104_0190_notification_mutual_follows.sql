-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0190 mutual follows. READ ONLY, ROLLBACK.
-- PASS = the function exists, is SECURITY INVOKER (runs under the caller's RLS)
-- with search_path="", members can call it, anon cannot, and with no signed-in
-- caller it returns no rows. FAILS before apply. Prints counts only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE n integer;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regprocedure('public.notif_mutual_follow_counts(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: notif_mutual_follow_counts(uuid[]) missing (0190 not applied)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.notif_mutual_follow_counts(uuid[])')
              AND (prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""'])) THEN
    RAISE EXCEPTION 'PROBE FAIL: notif_mutual_follow_counts must be SECURITY INVOKER with search_path=""';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.notif_mutual_follow_counts(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.notif_mutual_follow_counts(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: callers wrong (members must, anon must not)';
  END IF;
  SELECT count(*) INTO n FROM public.notif_mutual_follow_counts(ARRAY[gen_random_uuid()]);
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: returned % row(s) with no signed-in caller', n;
  END IF;
  RAISE NOTICE 'NC0190 PASS (lane %): mutual-follow counts in place', current_setting('p32.lane');
END
$p$;

ROLLBACK;
