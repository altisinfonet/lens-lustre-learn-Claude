-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261103_0101 admin users platform filter. READ ONLY, ROLLBACK.
-- COUNTS ONLY — no member id, name or e-mail is printed.
--
-- PASS = both functions exist as 0101 creates them: SECURITY DEFINER,
-- search_path '', EXECUTE authenticated only (not anon, not PUBLIC), the
-- admin gate in the body. Before the apply it FAILS (expected).
--
-- Always reports (before the PASS/FAIL checks) the numbers each tab will show
-- with no search/role/badge: All · App users · Web users · Unknown, computed
-- directly from public.profiles (the PROBE has no admin session, so it does
-- not call the admin functions).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE
  f oid; n text; r record;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  SELECT count(*) AS a,
         count(*) FILTER (WHERE last_platform = 'app') AS app,
         count(*) FILTER (WHERE last_platform = 'web') AS web,
         count(*) FILTER (WHERE last_platform IS NULL) AS unk,
         count(*) FILTER (WHERE last_platform IS NOT NULL AND last_platform NOT IN ('app', 'web')) AS other
    INTO r FROM public.profiles;
  RAISE NOTICE 'TABS (lane %): All=% · App users=% · Web users=% · Unknown=% · other values=%',
    current_setting('p32.lane'), r.a, r.app, r.web, r.unk, r.other;

  IF to_regprocedure('public.admin_search_users_v2(text, text, text, text, integer, integer)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: admin_search_users_v2 missing (the fallback the UI relies on)';
  END IF;

  FOREACH n IN ARRAY ARRAY[
    'public.admin_search_users_v3(text, text, text, text, text, integer, integer)',
    'public.admin_user_platform_counts(text, text, text, text)'] LOOP
    f := to_regprocedure(n);
    IF f IS NULL THEN
      RAISE EXCEPTION 'PROBE FAIL: % missing (0101 not applied)', n;
    END IF;
    IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = f) THEN
      RAISE EXCEPTION 'PROBE FAIL: % is not SECURITY DEFINER with search_path=""', n;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) x WHERE p.oid = f AND x.grantee = 0) THEN
      RAISE EXCEPTION 'PROBE FAIL: % EXECUTE is not authenticated-only', n;
    END IF;
    IF position('has_role(auth.uid(), ''admin'')' IN pg_get_functiondef(f)) = 0
       OR position('Not authorized' IN pg_get_functiondef(f)) = 0 THEN
      RAISE EXCEPTION 'PROBE FAIL: % has no admin gate', n;
    END IF;
  END LOOP;

  RAISE NOTICE 'PROBE PASS: 20261103_0101 present as intended';
END
$p$;

ROLLBACK;
