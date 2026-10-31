-- PROBE for 20261003_0001_user_blocks.sql. READS ONLY. Ends in ROLLBACK.
-- Raises (and so fails the run) if any assertion is false.
BEGIN;
DO $probe$
DECLARE _n int;
BEGIN
  IF to_regclass('public.user_blocks') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.user_blocks does not exist';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_blocks'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL: RLS is not enabled on public.user_blocks';
  END IF;
  IF has_table_privilege('anon', 'public.user_blocks', 'SELECT')
     OR has_table_privilege('anon', 'public.user_blocks', 'INSERT')
     OR has_table_privilege('anon', 'public.user_blocks', 'DELETE') THEN
    RAISE EXCEPTION 'PROBE FAIL: anon holds a privilege on public.user_blocks';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.user_blocks', 'SELECT')
      AND has_table_privilege('authenticated', 'public.user_blocks', 'INSERT')
      AND has_table_privilege('authenticated', 'public.user_blocks', 'DELETE')) THEN
    RAISE EXCEPTION 'PROBE FAIL: authenticated lacks SELECT/INSERT/DELETE on public.user_blocks';
  END IF;
  SELECT count(*) INTO _n FROM pg_policies WHERE schemaname='public' AND tablename='user_blocks';
  IF _n <> 4 THEN
    RAISE EXCEPTION 'PROBE FAIL: expected 4 policies on user_blocks, found %', _n;
  END IF;
  IF has_function_privilege('anon', 'public.notify_admin_user_blocked()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notify_admin_user_blocked()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: notify_admin_user_blocked() is executable by an API role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.user_blocks'::regclass AND tgname='user_blocks_notify_admin') THEN
    RAISE EXCEPTION 'PROBE FAIL: trigger user_blocks_notify_admin missing';
  END IF;
  RAISE NOTICE 'PROBE PASS: user_blocks present, RLS on, 4 policies, anon closed, trigger fn closed';
END
$probe$;
ROLLBACK;
