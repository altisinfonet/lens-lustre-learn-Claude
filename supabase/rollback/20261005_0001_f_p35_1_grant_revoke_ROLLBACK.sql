-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261005_0001 — F-P35-1 grant revoke
-- Re-grants to PUBLIC, anon and authenticated exactly the privileges each of
-- the six tables held before 0001 (saved in public.f_p35_1_acl_before), then
-- drops that table (it holds ACLs only, no member data). Rows and policies were
-- never touched, so nothing else is restored.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires the saved ACL table.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  IF to_regclass('public.f_p35_1_acl_before') IS NULL THEN
    RAISE EXCEPTION 'FP351-0001-RB-PRE-001: public.f_p35_1_acl_before is missing — 0001 is not applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DO $regrant$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.relname, a.privilege_type,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee
      FROM public.f_p35_1_acl_before s, LATERAL aclexplode(s.relacl) a
     WHERE a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
  LOOP
    IF to_regclass('public.' || quote_ident(r.relname)) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO %s', r.privilege_type, r.relname, r.grantee);
    END IF;
  END LOOP;
END
$regrant$;

DO $postconditions$
DECLARE n int;
BEGIN
  -- Each table's (grantee, privilege) set equals the saved one.
  SELECT count(*) INTO n FROM public.f_p35_1_acl_before s
   WHERE to_regclass('public.' || quote_ident(s.relname)) IS NOT NULL
     AND (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (SELECT a.grantee::text || ':' || a.privilege_type AS x FROM aclexplode(s.relacl) a) q)
      <> (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM (SELECT a.grantee::text || ':' || a.privilege_type AS x
                                                                 FROM pg_class c, aclexplode(c.relacl) a
                                                                WHERE c.oid = to_regclass('public.' || quote_ident(s.relname))) q);
  IF n > 0 THEN
    RAISE EXCEPTION 'FP351-0001-RB-POST-001: % table(s) do not hold exactly their pre-0001 privileges', n USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

DROP TABLE public.f_p35_1_acl_before;

COMMIT;
